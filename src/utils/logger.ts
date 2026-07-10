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
  private static writeStream: fs.WriteStream | null = null;

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
      // Cerrar stream anterior si existe (rotación de día)
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }
    }

    if (!this.initialized) {
      // Crear WriteStream en modo append
      this.writeStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });

      // Agregar separador al inicio de cada sesión
      const separator = `\n${'='.repeat(50)}\n[SESIÓN INICIADA: ${new Date().toLocaleString('es-CL')}]\n${'='.repeat(50)}\n`;
      this.writeStream.write(separator);
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

  private static sanitizeMessage(message: string): string {
    return message
      .replace(/(Client-ID\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
      .replace(/((?:IMGUR_CLIENT_ID|DISCORD_CLIENT_ID)\s*=\s*)\S+/gi, '$1[REDACTED]')
      .replace(
        /((?:access_token|refresh_token|client_secret|password|token)\s*["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
        '$1[REDACTED]'
      );
  }

  private static writeToFile(logLine: string): void {
    this.init();
    if (this.writeStream) {
      this.writeStream.write(logLine);
    }
  }

  private static log(level: LogLevel, message: string): void {
    // Sanitizar una sola vez
    const sanitizedMessage = this.sanitizeMessage(message);
    const time = this.formatTime();
    const dateTime = this.formatDateTime();
    const prefix = `[${time}] [${level}]`;

    // Escribir a archivo (ya sanitizado)
    const logLine = `[${dateTime}] [${level}] ${sanitizedMessage}\n`;
    this.writeToFile(logLine);

    // Escribir a consola
    switch (level) {
      case LogLevel.ERROR:
        console.error(`${prefix} ${sanitizedMessage}`);
        break;
      case LogLevel.WARN:
        console.warn(`${prefix} ${sanitizedMessage}`);
        break;
      case LogLevel.DEBUG:
        // Debug solo a archivo, no a consola
        break;
      default:
        console.log(`${prefix} ${sanitizedMessage}`);
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

  static getLogFilePath(): string {
    this.init();
    return this.currentLogFile;
  }

  static close(): void {
    if (this.writeStream) {
      try {
        const separator = `\n${'='.repeat(50)}\n[SESIÓN FINALIZADA: ${new Date().toLocaleString('es-CL')}]\n${'='.repeat(50)}\n`;
        this.writeStream.write(separator);
        this.writeStream.end();
        this.writeStream = null;
      } catch (error) {
        // Silenciar errores de cierre
      }
    }
  }
}

export default Logger;
