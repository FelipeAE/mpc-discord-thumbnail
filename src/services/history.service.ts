import * as fs from 'fs';
import * as path from 'path';
import Logger from '../utils/logger';
import { cleanFilename } from '../utils/helpers';

export interface HistoryEntry {
  file: string;
  cleanTitle: string;
  startTime: string;
  endTime: string;
  watchedDurationMs: number;
}

export class HistoryService {
  private historyFile: string;
  private dataDir: string;
  private currentSession: {
    file: string;
    startTime: Date;
    watchedDurationMs: number;
  } | null = null;
  private readonly MAX_HISTORY_ENTRIES = 1000;

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.historyFile = path.join(this.dataDir, 'history.json');
  }

  /**
   * Inicia una nueva sesión de reproducción para un archivo
   */
  startSession(file: string): void {
    if (this.currentSession && this.currentSession.file === file) {
      return; // Ya está corriendo la sesión para este archivo
    }

    if (this.currentSession) {
      this.endSession(); // Cerrar sesión previa si había
    }

    this.currentSession = {
      file,
      startTime: new Date(),
      watchedDurationMs: 0
    };
    Logger.debug(`Historial: Nueva sesión iniciada para "${file}"`);
  }

  /**
   * Actualiza el progreso de tiempo visto para la sesión actual
   */
  updateProgress(watchedMs: number): void {
    if (this.currentSession) {
      this.currentSession.watchedDurationMs = watchedMs;
    }
  }

  /**
   * Finaliza la sesión actual y la guarda en el archivo de historial
   */
  endSession(): void {
    if (!this.currentSession) return;

    // Solo guardar sesiones con reproducción real (ej: más de 5 segundos)
    if (this.currentSession.watchedDurationMs < 5000) {
      Logger.debug(`Historial: Ignorando sesión corta para "${this.currentSession.file}" (${Math.round(this.currentSession.watchedDurationMs / 1000)}s)`);
      this.currentSession = null;
      return;
    }

    const entry: HistoryEntry = {
      file: this.currentSession.file,
      cleanTitle: cleanFilename(this.currentSession.file),
      startTime: this.currentSession.startTime.toISOString(),
      endTime: new Date().toISOString(),
      watchedDurationMs: Math.round(this.currentSession.watchedDurationMs)
    };

    try {
      this.ensureDataDirectory();
      
      let history: HistoryEntry[] = [];
      if (fs.existsSync(this.historyFile)) {
        const fileContent = fs.readFileSync(this.historyFile, 'utf8');
        try {
          history = JSON.parse(fileContent);
          if (!Array.isArray(history)) history = [];
        } catch (e) {
          Logger.warn('Historial: history.json corrupto, reiniciando historial');
          history = [];
        }
      }

      // Añadir la nueva entrada al inicio
      history.unshift(entry);

      // Limitar el tamaño del historial
      if (history.length > this.MAX_HISTORY_ENTRIES) {
        history = history.slice(0, this.MAX_HISTORY_ENTRIES);
      }

      fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2), 'utf8');
      Logger.info(`Historial: Sesión guardada para "${entry.cleanTitle}" (visto: ${Math.round(entry.watchedDurationMs / 60000)} min)`);
    } catch (error) {
      Logger.error('Historial: Error al escribir en history.json', error as Error);
    } finally {
      this.currentSession = null;
    }
  }

  private ensureDataDirectory(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }
}
