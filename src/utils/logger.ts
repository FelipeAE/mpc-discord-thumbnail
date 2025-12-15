import * as fs from 'fs';
import * as path from 'path';

enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

class Logger {
  private static logFile: string = path.join(process.cwd(), 'app.log');
  private static initialized: boolean = false;

  private static init(): void {
    if (this.initialized) return;

    // Agregar separador al inicio de cada sesión
    const separator = `\n${'='.repeat(50)}\n[SESIÓN INICIADA: ${new Date().toLocaleString('es-CL')}]\n${'='.repeat(50)}\n`;
    fs.appendFileSync(this.logFile, separator);
    this.initialized = true;
  }

  private static formatTime(): string {
    return new Date().toLocaleTimeString('es-CL');
  }

  private static formatDate(): string {
    return new Date().toLocaleString('es-CL');
  }

  private static writeToFile(level: LogLevel, message: string): void {
    this.init();
    const logLine = `[${this.formatDate()}] [${level}] ${message}\n`;
    fs.appendFileSync(this.logFile, logLine);
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
