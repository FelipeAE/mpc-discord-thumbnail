import axios from 'axios';
import { PlayerStatus, PlayerService } from '../types';
import { formatTime } from '../utils/helpers';
import Logger from '../utils/logger';

export class VlcService implements PlayerService {
  name = 'VLC';
  private baseUrl: string;
  private password?: string;

  constructor(host: string, port: number, password?: string) {
    this.baseUrl = `http://${host}:${port}`;
    this.password = password;
  }

  private getAuthHeaders() {
    if (!this.password) return {};
    const token = Buffer.from(`:${this.password}`).toString('base64');
    return {
      Authorization: `Basic ${token}`
    };
  }

  async isConnected(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/requests/status.json`, {
        headers: this.getAuthHeaders(),
        timeout: 2000
      });
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<PlayerStatus | null> {
    try {
      const response = await axios.get<any>(`${this.baseUrl}/requests/status.json`, {
        headers: this.getAuthHeaders(),
        timeout: 3000
      });

      const data = response.data;
      if (!data) return null;

      // Extraer nombre del archivo
      let file = '';
      let filepath = '';
      if (data.information?.category?.meta) {
        const meta = data.information.category.meta;
        file = meta.filename || meta.title || '';
        filepath = meta.filename || '';
      }

      // Convertir estados de VLC
      let state: 'stopped' | 'paused' | 'playing' = 'stopped';
      let stateCode = 0;
      if (data.state === 'playing') {
        state = 'playing';
        stateCode = 2;
      } else if (data.state === 'paused') {
        state = 'paused';
        stateCode = 1;
      }

      const position = Math.round((data.time || 0) * 1000); // de segundos a ms
      const duration = Math.round((data.length || 0) * 1000); // de segundos a ms

      return {
        file,
        filepath,
        state,
        stateCode,
        position,
        duration,
        positionString: formatTime(position),
        durationString: formatTime(duration)
      };
    } catch (error) {
      Logger.debug(`VLC: No se pudo obtener el estado: ${(error as Error).message}`);
      return null;
    }
  }

  async getSnapshot(): Promise<Buffer | null> {
    // VLC HTTP API no soporta capturas de pantalla de video de manera nativa sin configuraciones complejas externas.
    // Retornamos null y el sistema usará AniList cover (si se encuentra) o no mostrará imagen.
    return null;
  }
}
