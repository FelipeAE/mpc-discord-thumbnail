import axios from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';
import * as path from 'path';
import { ImgurUploadResponse, UploadReason } from '../types';
import { calculateHash } from '../utils/helpers';
import Logger from '../utils/logger';

export type UploadProvider = 'imgur' | 'catbox' | 'imgbb';

export class UploadService {
  private provider: UploadProvider;
  private imgurClientId: string;
  private imgbbApiKey?: string;
  
  private lastHash: string = '';
  private lastUrl: string = '';
  private lastUploadTime: number = 0;
  private backoffUntil: number = 0;
  private consecutiveRateLimitErrors: number = 0;
  private lastBackoffLogTime: number = 0;
  private uploadInterval: number;
  private uniqueImageCount: number = 0;
  private sessionStartTime: number = Date.now();
  private rateLimitThreshold: number;
  
  private deleteQueueFile: string;
  private dataDir: string;

  constructor(
    provider: UploadProvider,
    imgurClientId: string,
    uploadIntervalMs: number = 120000,
    rateLimitThreshold: number = 60,
    imgbbApiKey?: string
  ) {
    this.provider = provider;
    this.imgurClientId = imgurClientId;
    this.uploadInterval = uploadIntervalMs;
    this.rateLimitThreshold = rateLimitThreshold;
    this.imgbbApiKey = imgbbApiKey;
    
    this.dataDir = path.join(process.cwd(), 'data');
    this.deleteQueueFile = path.join(this.dataDir, 'delete_queue.json');
  }

  private getRateLimitBackoffMs(): number {
    const baseDelay = Math.max(this.uploadInterval, 60000); // mínimo 1 minuto
    const exponent = Math.min(this.consecutiveRateLimitErrors, 6);
    const delay = baseDelay * Math.pow(2, exponent);
    return Math.min(delay, 1800000); // máximo 30 minutos
  }

  /**
   * Sube una imagen al proveedor seleccionado
   */
  async upload(imageBuffer: Buffer, forceUpload: boolean = false, reason?: UploadReason | string): Promise<string | null> {
    const now = Date.now();
    const timeSinceLastUpload = now - this.lastUploadTime;
    const isFileChange = reason === UploadReason.FILE_CHANGE;

    // Cooldown e intervalos (solo aplicar si ya tenemos una URL)
    if (!forceUpload && this.lastUrl && timeSinceLastUpload < this.uploadInterval) {
      const remainingSecs = Math.ceil((this.uploadInterval - timeSinceLastUpload) / 1000);
      Logger.debug(`Reutilizando imagen anterior (próxima subida en ${remainingSecs}s)`);
      return this.lastUrl;
    }

    const MIN_FORCED_INTERVAL = 30000;
    if (forceUpload && !isFileChange && this.lastUploadTime > 0 && timeSinceLastUpload < MIN_FORCED_INTERVAL) {
      Logger.debug(`Cooldown de subida forzada (${Math.ceil((MIN_FORCED_INTERVAL - timeSinceLastUpload) / 1000)}s restantes)`);
      return this.lastUrl || null;
    }

    const currentHash = calculateHash(imageBuffer);
    if (!forceUpload && currentHash === this.lastHash && this.lastUrl) {
      Logger.debug('Imagen sin cambios, reutilizando URL anterior');
      return this.lastUrl;
    }

    if (forceUpload) {
      Logger.info(`Subida forzada (${this.provider}): ${reason || 'razón no especificada'}`);
    }

    // Si es Imgur, respetar rate-limit backoff
    if (this.provider === 'imgur' && this.backoffUntil > now) {
      if (now - this.lastBackoffLogTime > 30000) {
        const remainingSecs = Math.ceil((this.backoffUntil - now) / 1000);
        Logger.warn(`Imgur rate-limited: aplicando ventana de espera (${remainingSecs}s restantes)`);
        this.lastBackoffLogTime = now;
      }
      if (isFileChange) {
        return null;
      }
      return this.lastUrl || null;
    }

    try {
      let uploadedUrl: string | null = null;
      let deleteHash: string | null = null;

      if (this.provider === 'imgur') {
        const form = new FormData();
        form.append('image', imageBuffer.toString('base64'));
        form.append('type', 'base64');

        const response = await axios.post<ImgurUploadResponse>(
          'https://api.imgur.com/3/image',
          form,
          {
            headers: {
              Authorization: `Client-ID ${this.imgurClientId}`,
              ...form.getHeaders()
            },
            timeout: 30000
          }
        );

        if (response.data.success) {
          this.backoffUntil = 0;
          this.consecutiveRateLimitErrors = 0;
          uploadedUrl = response.data.data.link;
          deleteHash = response.data.data.deletehash;
        }
      } else if (this.provider === 'catbox') {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', imageBuffer, { filename: 'snapshot.jpg', contentType: 'image/jpeg' });

        const response = await axios.post<string>(
          'https://catbox.moe/user/api.php',
          form,
          {
            headers: form.getHeaders(),
            timeout: 30000
          }
        );

        if (response.data && response.data.startsWith('https://')) {
          uploadedUrl = response.data.trim();
        } else {
          throw new Error(`Respuesta inválida de Catbox: ${response.data}`);
        }
      } else if (this.provider === 'imgbb') {
        if (!this.imgbbApiKey) {
          throw new Error('API Key de ImgBB no configurada');
        }
        const form = new FormData();
        form.append('image', imageBuffer.toString('base64'));

        const response = await axios.post<any>(
          `https://api.imgbb.com/1/upload?key=${this.imgbbApiKey}`,
          form,
          {
            headers: form.getHeaders(),
            timeout: 30000
          }
        );

        if (response.data?.success) {
          uploadedUrl = response.data.data.url;
        } else {
          throw new Error(`Respuesta inválida de ImgBB: ${JSON.stringify(response.data)}`);
        }
      }

      if (uploadedUrl) {
        this.lastHash = currentHash;
        this.lastUrl = `${uploadedUrl}?t=${now}`;
        this.lastUploadTime = now;
        this.uniqueImageCount++;

        const sessionTimeMs = now - this.sessionStartTime;
        const sessionTimeMin = Math.floor(sessionTimeMs / 60000);
        const sessionTimeStr = sessionTimeMin > 60 
          ? `${Math.floor(sessionTimeMin / 60)}h ${sessionTimeMin % 60}min` 
          : `${sessionTimeMin}min`;

        Logger.info(`📊 Imagen #${this.uniqueImageCount}/${this.rateLimitThreshold} | Sesión: ${sessionTimeStr}`);
        Logger.info(`Imagen subida exitosamente (${this.provider}): ${this.lastUrl}`);

        if (this.provider === 'imgur' && deleteHash) {
          await this.queueImgurDeletion(deleteHash);
        }

        return this.lastUrl;
      }

      throw new Error(`No se pudo procesar la respuesta de subida del proveedor ${this.provider}`);
    } catch (error) {
      if (this.provider === 'imgur' && axios.isAxiosError(error) && error.response?.status === 429) {
        this.consecutiveRateLimitErrors++;
        const backoffMs = this.getRateLimitBackoffMs();
        this.backoffUntil = now + backoffMs;
        this.lastUploadTime = now;
        Logger.warn(`Imgur HTTP 429: aplicando backoff de ${Math.ceil(backoffMs / 1000)}s`);
      } else {
        Logger.error(`Error al subir imagen a ${this.provider}: ${(error as Error).message}`);
      }
      return isFileChange ? null : (this.lastUrl || null);
    }
  }

  private async queueImgurDeletion(deletehash: string): Promise<void> {
    try {
      this.ensureDataDir();
      let queue: Array<{ hash: string; time: number }> = [];
      if (fs.existsSync(this.deleteQueueFile)) {
        queue = JSON.parse(fs.readFileSync(this.deleteQueueFile, 'utf8'));
      }
      queue.push({ hash: deletehash, time: Date.now() });
      fs.writeFileSync(this.deleteQueueFile, JSON.stringify(queue, null, 2), 'utf8');
      
      await this.processDeleteQueue(queue);
    } catch (e) {
      Logger.warn(`No se pudo encolar la eliminación de la imagen en Imgur: ${(e as Error).message}`);
    }
  }

  private async processDeleteQueue(queue: Array<{ hash: string; time: number }>): Promise<void> {
    // Conservamos las últimas 5 imágenes en Imgur para evitar fallas visuales temporales en Discord
    if (queue.length <= 5) return;

    const toDelete = queue.slice(0, queue.length - 5);
    const remaining = queue.slice(queue.length - 5);

    for (const item of toDelete) {
      try {
        Logger.debug(`Eliminando imagen antigua de Imgur (hash: ${item.hash})...`);
        await axios.delete(`https://api.imgur.com/3/image/${item.hash}`, {
          headers: {
            Authorization: `Client-ID ${this.imgurClientId}`
          },
          timeout: 10000
        });
        Logger.debug(`Imagen de Imgur eliminada exitosamente.`);
      } catch (error) {
        // Si no existe (404) o hay error, igual lo removemos de la cola para no reintentar infinitamente
        Logger.debug(`Error al borrar imagen de Imgur (se omite): ${(error as Error).message}`);
      }
    }

    try {
      fs.writeFileSync(this.deleteQueueFile, JSON.stringify(remaining, null, 2), 'utf8');
    } catch (e) {
      // Ignorar
    }
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  getLastUrl(): string {
    return this.lastUrl;
  }

  getLastUploadAgeMs(): number | null {
    if (this.lastUploadTime === 0) return null;
    return Math.max(0, Date.now() - this.lastUploadTime);
  }

  getRateLimitStatus(): { active: boolean; remainingSeconds: number } {
    if (this.provider !== 'imgur') {
      return { active: false, remainingSeconds: 0 };
    }
    const remainingMs = Math.max(0, this.backoffUntil - Date.now());
    return {
      active: remainingMs > 0,
      remainingSeconds: Math.ceil(remainingMs / 1000)
    };
  }

  reset(): void {
    this.lastHash = '';
    this.lastUrl = '';
    this.lastUploadTime = 0;
    this.backoffUntil = 0;
    this.consecutiveRateLimitErrors = 0;
    this.lastBackoffLogTime = 0;
  }

  getUniqueImageCount(): number {
    return this.uniqueImageCount;
  }

  resetUniqueImageCount(): void {
    this.uniqueImageCount = 0;
    this.sessionStartTime = Date.now();
    Logger.debug('Contador de imágenes únicas de subida reseteado');
  }
}
