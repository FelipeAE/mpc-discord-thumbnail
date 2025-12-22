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
  private uploadInterval: number;

  /**
   * @param clientId - Imgur Client ID
   * @param uploadIntervalMs - Intervalo mínimo entre subidas en ms (default: 120000 = 2 min)
   */
  constructor(clientId: string, uploadIntervalMs: number = 120000) {
    this.clientId = clientId;
    this.uploadInterval = uploadIntervalMs;
  }

  /**
   * Sube una imagen a Imgur (respetando el intervalo mínimo)
   * @param imageBuffer - Buffer de la imagen a subir
   * @param forceUpload - Si es true, ignora el intervalo y sube inmediatamente
   * @returns URL de la imagen o null si hay error
   */
  async upload(imageBuffer: Buffer, forceUpload: boolean = false): Promise<string | null> {
    const now = Date.now();
    const timeSinceLastUpload = now - this.lastUploadTime;

    // Si ya tenemos una URL, no es forzado, y no ha pasado el intervalo, reutilizar
    if (!forceUpload && this.lastUrl && timeSinceLastUpload < this.uploadInterval) {
      const remainingSecs = Math.ceil((this.uploadInterval - timeSinceLastUpload) / 1000);
      Logger.debug(`Reutilizando imagen anterior (próxima subida en ${remainingSecs}s)`);
      return this.lastUrl;
    }

    // Verificar si la imagen cambió (optimización adicional, solo si no es forzado)
    const currentHash = calculateHash(imageBuffer);
    if (!forceUpload && currentHash === this.lastHash && this.lastUrl) {
      Logger.debug('Imagen sin cambios, reutilizando URL anterior');
      return this.lastUrl;
    }

    if (forceUpload) {
      Logger.info('Subida forzada: detectado cambio de archivo');
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
        this.lastHash = currentHash;
        // Agregar timestamp para evitar cache de Discord
        this.lastUrl = `${response.data.data.link}?t=${now}`;
        this.lastUploadTime = now;
        Logger.info(`Imagen subida a Imgur: ${this.lastUrl}`);
        Logger.debug(`Imgur respuesta completa: id=${response.data.data.id}, type=${response.data.data.type}, size=${response.data.data.size || 'N/A'}`);
        return this.lastUrl;
      }

      Logger.error(`Imgur respondió con error: ${JSON.stringify(response.data)}`);
      return this.lastUrl || null;
    } catch (error) {
      const axiosError = error as any;
      if (axiosError.response) {
        Logger.error(`Error Imgur HTTP ${axiosError.response.status}: ${JSON.stringify(axiosError.response.data)}`);
      } else if (axiosError.code) {
        Logger.error(`Error Imgur red: ${axiosError.code} - ${axiosError.message}`);
      } else {
        Logger.error('Error al subir a Imgur', error as Error);
      }
      return this.lastUrl || null;
    }
  }

  /**
   * Obtiene la última URL subida
   */
  getLastUrl(): string {
    return this.lastUrl;
  }

  /**
   * Resetea el estado (útil cuando cambia el archivo)
   */
  reset(): void {
    this.lastHash = '';
    this.lastUrl = '';
    this.lastUploadTime = 0;
  }
}
