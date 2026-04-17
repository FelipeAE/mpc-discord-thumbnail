import axios from 'axios';
import FormData from 'form-data';
import { ImgurUploadResponse } from '../types';
import { calculateHash } from '../utils/helpers';
import Logger from '../utils/logger';

export class ImgurService {
  private clientId: string;
  private lastHash: string = '';
  private lastUrl: string = '';
  private lastUploadTime: number = 0;
  private backoffUntil: number = 0;
  private consecutiveRateLimitErrors: number = 0;
  private lastBackoffLogTime: number = 0;
  private uploadInterval: number;
  private uniqueImageCount: number = 0; // Contador de imágenes únicas subidas
  private sessionStartTime: number = Date.now(); // Tiempo de inicio de sesión
  private rateLimitThreshold: number; // Umbral de rate limit

  /**
   * @param clientId - Imgur Client ID
   * @param uploadIntervalMs - Intervalo mínimo entre subidas en ms (default: 120000 = 2 min)
   * @param rateLimitThreshold - Umbral de imágenes antes de rate limit (default: 60)
   */
  constructor(clientId: string, uploadIntervalMs: number = 120000, rateLimitThreshold: number = 60) {
    this.clientId = clientId;
    this.uploadInterval = uploadIntervalMs;
    this.rateLimitThreshold = rateLimitThreshold;
  }

  private getRateLimitBackoffMs(): number {
    const baseDelay = Math.max(this.uploadInterval, 60000); // mínimo 1 minuto
    const exponent = Math.min(this.consecutiveRateLimitErrors, 6); // hasta x64
    const delay = baseDelay * Math.pow(2, exponent);
    return Math.min(delay, 1800000); // máximo 30 minutos
  }

  /**
   * Sube una imagen a Imgur (respetando el intervalo mínimo)
   * @param imageBuffer - Buffer de la imagen a subir
   * @param forceUpload - Si es true, ignora el intervalo y sube inmediatamente
   * @param reason - Razón de la subida forzada (para logs)
   * @returns URL de la imagen o null si hay error
   */
  async upload(imageBuffer: Buffer, forceUpload: boolean = false, reason?: string): Promise<string | null> {
    const now = Date.now();
    const timeSinceLastUpload = now - this.lastUploadTime;
    // Cambio de archivo siempre tiene prioridad máxima
    const isFileChange = reason === 'cambio de archivo';

    // Si Imgur está rate-limited, respetar ventana de reintento
    if (this.backoffUntil > now) {
      if (now - this.lastBackoffLogTime > 30000) {
        const remainingSecs = Math.ceil((this.backoffUntil - now) / 1000);
        Logger.warn(`Imgur rate-limited: reintentando en ${remainingSecs}s`);
        this.lastBackoffLogTime = now;
      }
      // Evitar thumbnail viejo cuando cambió de capítulo y estamos en backoff
      if (isFileChange) {
        Logger.warn('Cambio de archivo detectado durante backoff de Imgur: evitando reutilizar thumbnail anterior');
        return null;
      }
      return this.lastUrl || null;
    }

    // Si ya tenemos una URL, no es forzado, y no ha pasado el intervalo, reutilizar
    if (!forceUpload && this.lastUrl && timeSinceLastUpload < this.uploadInterval) {
      const remainingSecs = Math.ceil((this.uploadInterval - timeSinceLastUpload) / 1000);
      Logger.debug(`Reutilizando imagen anterior (próxima subida en ${remainingSecs}s)`);
      return this.lastUrl;
    }

    // Cooldown mínimo de 30s para subidas forzadas (excepto cambio de archivo)
    const MIN_FORCED_INTERVAL = 30000;
    if (forceUpload && !isFileChange && this.lastUploadTime > 0 && timeSinceLastUpload < MIN_FORCED_INTERVAL) {
      Logger.debug(`Cooldown de subida forzada (${Math.ceil((MIN_FORCED_INTERVAL - timeSinceLastUpload) / 1000)}s restantes)`);
      return this.lastUrl || null;
    }

    // Verificar si la imagen cambió (optimización adicional, solo si no es forzado)
    const currentHash = calculateHash(imageBuffer);
    if (!forceUpload && currentHash === this.lastHash && this.lastUrl) {
      Logger.debug('Imagen sin cambios, reutilizando URL anterior');
      return this.lastUrl;
    }

    if (forceUpload) {
      Logger.info(`Subida forzada: ${reason || 'razón no especificada'}`);
    }

    try {
      const form = new FormData();
      form.append('image', imageBuffer.toString('base64'));
      form.append('type', 'base64');

      const response = await axios.post<ImgurUploadResponse>(
        'https://api.imgur.com/3/image',
        form,
        {
          headers: {
            Authorization: `Client-ID ${this.clientId}`,
            ...form.getHeaders()
          },
          timeout: 60000 // Aumentado a 60 segundos
        }
      );

      if (response.data.success) {
        this.backoffUntil = 0;
        this.consecutiveRateLimitErrors = 0;
        this.lastHash = currentHash;
        // Agregar timestamp para evitar cache de Discord
        this.lastUrl = `${response.data.data.link}?t=${now}`;
        this.lastUploadTime = now;
        this.uniqueImageCount++; // Incrementar contador de imágenes únicas
        
        // Log detallado de progreso hacia rate limit
        const sessionTimeMs = now - this.sessionStartTime;
        const sessionTimeMin = Math.floor(sessionTimeMs / 60000);
        const sessionTimeHours = Math.floor(sessionTimeMin / 60);
        const sessionTimeMinRemainder = sessionTimeMin % 60;
        const sessionTimeStr = sessionTimeHours > 0 
          ? `${sessionTimeHours}h ${sessionTimeMinRemainder}min` 
          : `${sessionTimeMin}min`;
        
        const remainingImages = this.rateLimitThreshold - this.uniqueImageCount;
        const intervalMin = this.uploadInterval / 60000;
        const remainingTimeMin = remainingImages * intervalMin;
        const remainingHours = Math.floor(remainingTimeMin / 60);
        const remainingMinRemainder = Math.round(remainingTimeMin % 60);
        const remainingTimeStr = remainingHours > 0 
          ? `${remainingHours}h ${remainingMinRemainder}min` 
          : `${remainingMinRemainder}min`;
        
        Logger.info(`📊 Imagen #${this.uniqueImageCount}/${this.rateLimitThreshold} | Sesión: ${sessionTimeStr} | Rate limit estimado en: ${remainingTimeStr}`);
        Logger.info(`Imagen subida a Imgur: ${this.lastUrl}`);
        Logger.debug(`Imgur respuesta completa: id=${response.data.data.id}, type=${response.data.data.type}, size=${response.data.data.size || 'N/A'}`);
        return this.lastUrl;
      }

      Logger.error(`Imgur respondió con error: ${JSON.stringify(response.data)}`);
      return isFileChange ? null : (this.lastUrl || null);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 429) {
          this.consecutiveRateLimitErrors++;
          const backoffMs = this.getRateLimitBackoffMs();
          this.backoffUntil = now + backoffMs;
          this.lastUploadTime = now;
          Logger.warn(`Imgur HTTP 429: aplicando backoff de ${Math.ceil(backoffMs / 1000)}s`);
          return isFileChange ? null : (this.lastUrl || null);
        }

        if (status) {
          Logger.error(`Error Imgur HTTP ${status}: ${JSON.stringify(error.response?.data)}`);
        } else if (error.code) {
          Logger.error(`Error Imgur red: ${error.code} - ${error.message}`);
        } else {
          Logger.error(`Error Imgur: ${error.message}`);
        }
      } else {
        Logger.error('Error al subir a Imgur', error as Error);
      }
      return isFileChange ? null : (this.lastUrl || null);
    }
  }

  /**
   * Obtiene la última URL subida
   */
  getLastUrl(): string {
    return this.lastUrl;
  }

  /**
   * Estado actual del backoff por rate limit (HTTP 429)
   */
  getRateLimitStatus(): { active: boolean; remainingSeconds: number } {
    const remainingMs = Math.max(0, this.backoffUntil - Date.now());
    return {
      active: remainingMs > 0,
      remainingSeconds: Math.ceil(remainingMs / 1000)
    };
  }

  /**
   * Resetea el estado (útil cuando cambia el archivo)
   */
  reset(): void {
    this.lastHash = '';
    this.lastUrl = '';
    this.lastUploadTime = 0;
    this.backoffUntil = 0;
    this.consecutiveRateLimitErrors = 0;
    this.lastBackoffLogTime = 0;
  }

  /**
   * Obtiene el contador de imágenes únicas subidas
   */
  getUniqueImageCount(): number {
    return this.uniqueImageCount;
  }

  /**
   * Resetea el contador de imágenes únicas (después de reiniciar Discord)
   */
  resetUniqueImageCount(): void {
    this.uniqueImageCount = 0;
    this.sessionStartTime = Date.now(); // También resetear tiempo de sesión
    Logger.debug('Contador de imágenes únicas y tiempo de sesión reseteados');
  }
}
