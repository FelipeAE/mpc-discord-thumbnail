import { Client } from '@xhayper/discord-rpc';
import Logger from '../utils/logger';

export interface ActivityOptions {
  details: string;
  state: string;
  largeImageKey?: string;
  largeImageText?: string;
  smallImageKey?: string;
  smallImageText?: string;
  startTimestamp?: number;
}

export class DiscordService {
  private client: Client;
  private clientId: string;
  private connected: boolean = false;

  constructor(clientId: string) {
    this.clientId = clientId;
    this.client = new Client({ clientId });

    this.client.on('ready', () => {
      Logger.info('Conectado a Discord RPC');
      this.connected = true;
    });

    this.client.on('disconnected', () => {
      Logger.warn('Desconectado de Discord RPC');
      this.connected = false;
    });
  }

  /**
   * Conecta al cliente de Discord con timeout
   */
  async connect(): Promise<boolean> {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout conectando a Discord')), 5000);
      });
      await Promise.race([this.client.login(), timeoutPromise]);
      return true;
    } catch (error) {
      Logger.error('Error al conectar con Discord', error as Error);
      this.connected = false;
      return false;
    }
  }

  /**
   * Establece la actividad (Rich Presence)
   */
  async setActivity(options: ActivityOptions): Promise<void> {
    if (!this.connected) {
      Logger.debug('Discord no conectado, intentando reconectar...');
      const reconnected = await this.connect();
      if (!reconnected) {
        return; // No bloquear si no puede reconectar
      }
    }

    try {
      await this.client.user?.setActivity({
        details: options.details,
        state: options.state,
        largeImageKey: options.largeImageKey,
        largeImageText: options.largeImageText || options.details,
        smallImageKey: options.smallImageKey,
        smallImageText: options.smallImageText,
        startTimestamp: options.startTimestamp
      });
    } catch (error) {
      Logger.error('Error al establecer actividad', error as Error);
      this.connected = false; // Marcar como desconectado para reintentar
    }
  }

  /**
   * Limpia la actividad
   */
  async clearActivity(): Promise<void> {
    try {
      await this.client.user?.clearActivity();
    } catch (error) {
      Logger.debug('Error al limpiar actividad');
    }
  }

  /**
   * Desconecta del cliente Discord
   */
  disconnect(): void {
    this.client.destroy();
    this.connected = false;
  }

  /**
   * Verifica si está conectado
   */
  isConnected(): boolean {
    return this.connected;
  }
}
