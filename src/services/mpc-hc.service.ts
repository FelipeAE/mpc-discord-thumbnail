import axios from 'axios';
import { MpcStatus } from '../types';
import { parseMpcVariables, formatTime } from '../utils/helpers';
import Logger from '../utils/logger';

export class MpcHcService {
  private baseUrl: string;

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`;
  }

  /**
   * Obtiene el estado actual de MPC-HC
   */
  async getStatus(): Promise<MpcStatus | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/variables.html`, {
        timeout: 5000
      });

      const vars = parseMpcVariables(response.data);

      const stateCode = parseInt(vars.state || '-1', 10);
      let state: 'stopped' | 'paused' | 'playing' = 'stopped';
      if (stateCode === 1) state = 'paused';
      else if (stateCode === 2) state = 'playing';

      const position = parseInt(vars.position || '0', 10);
      const duration = parseInt(vars.duration || '0', 10);

      return {
        file: vars.file || '',
        filepath: vars.filepath || '',
        state,
        stateCode,
        position,
        duration,
        positionString: formatTime(position),
        durationString: formatTime(duration)
      };
    } catch (error) {
      Logger.debug('MPC-HC no disponible o no está corriendo');
      return null;
    }
  }

  /**
   * Captura un snapshot del frame actual
   */
  async getSnapshot(): Promise<Buffer | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/snapshot.jpg`, {
        responseType: 'arraybuffer',
        timeout: 10000
      });

      return Buffer.from(response.data);
    } catch (error) {
      Logger.error('Error al capturar snapshot');
      return null;
    }
  }

  /**
   * Verifica si MPC-HC está accesible
   */
  async isConnected(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/variables.html`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}
