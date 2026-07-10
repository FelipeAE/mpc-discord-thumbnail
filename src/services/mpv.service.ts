import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { PlayerStatus, PlayerService } from '../types';
import { formatTime } from '../utils/helpers';
import Logger from '../utils/logger';

export class MpvService implements PlayerService {
  name = 'mpv';
  private pipePath = '\\\\.\\pipe\\mpvsocket';
  private tempScreenshotPath: string;

  constructor() {
    this.tempScreenshotPath = path.join(process.cwd(), 'temp_mpv_screenshot.jpg');
  }

  private sendIpcCommand(command: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const client = net.connect(this.pipePath);
      let dataBuffer = '';

      client.on('connect', () => {
        client.write(JSON.stringify({ command }) + '\n');
      });

      client.on('data', (data) => {
        dataBuffer += data.toString();
        // Las respuestas de mpv terminan en salto de línea
        if (dataBuffer.endsWith('\n')) {
          try {
            const lines = dataBuffer.trim().split('\n');
            const response = JSON.parse(lines[0]);
            client.end();
            resolve(response);
          } catch (e) {
            client.end();
            reject(e);
          }
        }
      });

      client.on('error', (err) => {
        reject(err);
      });

      // Timeout de 1 segundo para comandos IPC
      client.setTimeout(1000, () => {
        client.end();
        reject(new Error('Timeout de comunicación IPC con mpv'));
      });
    });
  }

  async isConnected(): Promise<boolean> {
    return new Promise((resolve) => {
      const client = net.connect(this.pipePath);
      client.on('connect', () => {
        client.end();
        resolve(true);
      });
      client.on('error', () => {
        resolve(false);
      });
    });
  }

  async getStatus(): Promise<PlayerStatus | null> {
    try {
      if (!(await this.isConnected())) return null;

      // Obtener propiedades necesarias
      const pathResponse = await this.sendIpcCommand(['get_property', 'path']);
      const posResponse = await this.sendIpcCommand(['get_property', 'time-pos']);
      const durResponse = await this.sendIpcCommand(['get_property', 'duration']);
      const pauseResponse = await this.sendIpcCommand(['get_property', 'pause']);

      const filepath = pathResponse.data || '';
      const file = path.basename(filepath);
      
      const isPaused = pauseResponse.data === true;
      const state = isPaused ? 'paused' : 'playing';
      const stateCode = isPaused ? 1 : 2;

      const position = Math.round((posResponse.data || 0) * 1000); // Convertir a ms
      const duration = Math.round((durResponse.data || 0) * 1000); // Convertir a ms

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
    } catch (e) {
      Logger.debug(`mpv: No se pudo obtener el estado: ${(e as Error).message}`);
      return null;
    }
  }

  async getSnapshot(): Promise<Buffer | null> {
    try {
      if (!(await this.isConnected())) return null;

      // Limpiar captura previa si quedó colgada
      if (fs.existsSync(this.tempScreenshotPath)) {
        try {
          fs.unlinkSync(this.tempScreenshotPath);
        } catch {}
      }

      // Ejecutar captura de pantalla a archivo temporal
      await this.sendIpcCommand(['screenshot-to-file', this.tempScreenshotPath, 'video']);

      // Esperar brevemente a que el archivo se escriba por completo en disco
      let attempts = 0;
      while (!fs.existsSync(this.tempScreenshotPath) && attempts < 10) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }

      if (fs.existsSync(this.tempScreenshotPath)) {
        const buffer = fs.readFileSync(this.tempScreenshotPath);
        // Borrar el archivo temporal inmediatamente después de leerlo
        fs.unlinkSync(this.tempScreenshotPath);
        return buffer;
      }

      return null;
    } catch (e) {
      Logger.error(`mpv: Error al capturar snapshot: ${(e as Error).message}`);
      return null;
    }
  }
}
