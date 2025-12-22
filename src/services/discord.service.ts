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
  private lastSuccessfulUpdate: number = Date.now();
  private lastReconnectTime: number = Date.now();
  private activityCount: number = 0; // Contador de actualizaciones desde última reconexión
  private readonly RECONNECT_INTERVAL = 1800000; // 30 minutos máximo sin reconectar
  private readonly RECONNECT_ACTIVITY_COUNT = 100; // Reconectar cada 100 actualizaciones (~16 min a 10s/update)

  constructor(clientId: string) {
    this.clientId = clientId;
    this.client = new Client({ clientId });

    this.client.on('ready', () => {
      Logger.info('Conectado a Discord RPC');
      this.connected = true;
      this.lastSuccessfulUpdate = Date.now();
    });

    this.client.on('disconnected', () => {
      Logger.warn('Desconectado de Discord RPC');
      this.connected = false;
    });
  }

  /**
   * Verifica si necesita reconectar basado en tiempo o cantidad de actualizaciones
   */
  private needsReconnect(): boolean {
    const timeSinceLastReconnect = Date.now() - this.lastReconnectTime;
    // Reconectar si pasaron 30 min O si hubo 100 actualizaciones
    return timeSinceLastReconnect > this.RECONNECT_INTERVAL || 
           this.activityCount >= this.RECONNECT_ACTIVITY_COUNT;
  }

  /**
   * Fuerza reconexión recreando el cliente
   */
  private async forceReconnect(): Promise<boolean> {
    Logger.info(`Forzando reconexión a Discord RPC (después de ${this.activityCount} actualizaciones)...`);
    try {
      this.client.destroy();
    } catch (e) {
      // Ignorar errores al destruir
    }
    this.connected = false;
    this.activityCount = 0; // Reset contador
    this.lastReconnectTime = Date.now(); // Reset tiempo
    this.client = new Client({ clientId: this.clientId });
    
    this.client.on('ready', () => {
      this.connected = true;
      this.lastSuccessfulUpdate = Date.now();
    });

    this.client.on('disconnected', () => {
      this.connected = false;
    });

    return await this.connect();
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
    // Incrementar contador de actividad
    this.activityCount++;
    
    // Verificar si necesita reconexión periódica (solo cuando hay actividad)
    if (this.needsReconnect()) {
      await this.forceReconnect();
    }

    if (!this.connected) {
      Logger.debug('Discord no conectado, intentando reconectar...');
      const reconnected = await this.connect();
      if (!reconnected) {
        return; // No bloquear si no puede reconectar
      }
    }

    try {
      Logger.debug(`Discord: enviando imagen ${options.largeImageKey || 'ninguna'}`);
      const result = await this.client.user?.setActivity({
        details: options.details,
        state: options.state,
        largeImageKey: options.largeImageKey,
        largeImageText: options.largeImageText || options.details,
        smallImageKey: options.smallImageKey,
        smallImageText: options.smallImageText,
        startTimestamp: options.startTimestamp
      });
      this.lastSuccessfulUpdate = Date.now();
      
      // Log detallado del resultado de Discord (solo cada 10 actualizaciones para no saturar)
      if (result && this.activityCount % 10 === 0) {
        Logger.debug(`Discord RPC resultado (#${this.activityCount}): imagen recibida OK`);
      } else if (!result) {
        Logger.warn('Discord RPC setActivity devolvió undefined/null');
      }
    } catch (error) {
      Logger.error('Error al establecer actividad en Discord', error as Error);
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
