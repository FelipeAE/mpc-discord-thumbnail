import * as fs from 'fs';
import * as path from 'path';

enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

class Logger {
  private static logsDir: string = path.join(process.cwd(), 'logs');
  private static currentDate: string = '';
  private static currentLogFile: string = '';
  private static initialized: boolean = false;
  private static maxLogDays: number = 7; // Mantener logs de los últimos 7 días

  private static getDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private static init(): void {
    // Crear carpeta logs si no existe
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }

    const today = this.getDateString();

    // Si es un nuevo día o primera inicialización
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.currentLogFile = path.join(this.logsDir, `app-${today}.log`);
      this.initialized = false;
    }

    if (!this.initialized) {
      // Agregar separador al inicio de cada sesión
      const separator = `\n${'='.repeat(50)}\n[SESIÓN INICIADA: ${new Date().toLocaleString('es-CL')}]\n${'='.repeat(50)}\n`;
      fs.appendFileSync(this.currentLogFile, separator);
      this.initialized = true;

      // Limpiar logs antiguos
      this.cleanOldLogs();
    }
  }

  private static cleanOldLogs(): void {
    try {
      const files = fs.readdirSync(this.logsDir);
      const now = new Date();
      const maxAge = this.maxLogDays * 24 * 60 * 60 * 1000; // días en ms

      for (const file of files) {
        if (!file.startsWith('app-') || !file.endsWith('.log')) continue;

        const filePath = path.join(this.logsDir, file);
        const stats = fs.statSync(filePath);
        const age = now.getTime() - stats.mtime.getTime();

        if (age > maxAge) {
          fs.unlinkSync(filePath);
          console.log(`[Logger] Eliminado log antiguo: ${file}`);
        }
      }
    } catch (error) {
      // Silenciar errores de limpieza
    }
  }

  private static formatTime(): string {
    return new Date().toLocaleTimeString('es-CL');
  }

  private static formatDateTime(): string {
    return new Date().toLocaleString('es-CL');
  }

  private static writeToFile(level: LogLevel, message: string): void {
    this.init();
    const logLine = `[${this.formatDateTime()}] [${level}] ${message}\n`;
    fs.appendFileSync(this.currentLogFile, logLine);
  }

  private static log(level: LogLevel, message: string): void {
    const time = this.formatTime();
    const prefix = `[${time}] [${level}]`;

    // Escribir a archivo
    this.writeToFile(level, message);

    // Escribir a consola
    switch (level) {
      case LogLevel.ERROR:
        console.error(`${prefix} ${message}`);
        break;
      case LogLevel.WARN:
        console.warn(`${prefix} ${message}`);
        break;
      case LogLevel.DEBUG:
        // Debug solo a archivo, no a consola
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }

  static info(message: string): void {
    this.log(LogLevel.INFO, message);
  }

  static error(message: string, error?: Error): void {
    const fullMessage = error ? `${message}: ${error.message}\nStack: ${error.stack}` : message;
    this.log(LogLevel.ERROR, fullMessage);
  }

  static debug(message: string): void {
    this.log(LogLevel.DEBUG, message);
  }

  static warn(message: string): void {
    this.log(LogLevel.WARN, message);
  }
}

export default Logger;
