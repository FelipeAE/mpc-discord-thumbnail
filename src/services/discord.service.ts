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
  private pausedSince: number = 0; // Timestamp de cuando empezó la pausa
  private activityActive: boolean = false; // Rastrear si hay una actividad activa en Discord
  private readonly RECONNECT_INTERVAL = 1800000; // 30 minutos máximo sin reconectar
  private readonly RECONNECT_ACTIVITY_COUNT = 50; // Reconectar cada 50 actualizaciones (~8 min a 10s/update)
  private readonly PAUSED_RECONNECT_INTERVAL = 300000; // 5 minutos - reconectar más seguido si está pausado
  private readonly DISCORD_TEXT_LIMIT = 128;

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
   * Notifica que el estado cambió a pausado
   */
  setPausedState(isPaused: boolean): void {
    if (isPaused && this.pausedSince === 0) {
      this.pausedSince = Date.now();
      Logger.debug('Discord: estado cambiado a pausado');
    } else if (!isPaused) {
      this.pausedSince = 0;
    }
  }

  /**
   * Verifica si necesita reconectar basado en tiempo o cantidad de actualizaciones
   */
  private needsReconnect(): boolean {
    const now = Date.now();
    const timeSinceLastReconnect = now - this.lastReconnectTime;
    
    // Si está pausado por más de 5 min, usar intervalo más corto
    const isPausedLong = this.pausedSince > 0 && (now - this.pausedSince) > this.PAUSED_RECONNECT_INTERVAL;
    const effectiveInterval = isPausedLong ? this.PAUSED_RECONNECT_INTERVAL : this.RECONNECT_INTERVAL;
    
    const needsIt = timeSinceLastReconnect > effectiveInterval || 
           this.activityCount >= this.RECONNECT_ACTIVITY_COUNT;
    
    if (needsIt) {
      const reason = timeSinceLastReconnect > effectiveInterval 
        ? `tiempo (${Math.floor(timeSinceLastReconnect / 60000)} min)` 
        : `actualizaciones (${this.activityCount})`;
      Logger.debug(`Discord: reconexión necesaria por ${reason}${isPausedLong ? ' [PAUSADO]' : ''}`);
    }
    
    return needsIt;
  }

  /**
   * Fuerza reconexión recreando el cliente
   */
  async forceReconnect(): Promise<boolean> {
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
      const details = this.truncateForDiscord(options.details);
      const state = this.truncateForDiscord(options.state);
      const largeImageText = this.truncateForDiscord(options.largeImageText || options.details);
      const smallImageText = this.truncateForDiscord(options.smallImageText);

      Logger.debug(`Discord: enviando imagen ${options.largeImageKey || 'ninguna'}`);
      const result = await this.client.user?.setActivity({
        details,
        state,
        largeImageKey: options.largeImageKey,
        largeImageText,
        smallImageKey: options.smallImageKey,
        smallImageText,
        startTimestamp: options.startTimestamp
      });
      this.lastSuccessfulUpdate = Date.now();
      this.activityActive = true;
      
      // Log detallado del resultado de Discord para debug
      if (result) {
        // Cast para acceder a assets que puede existir en la respuesta real
        const resultAny = result as Record<string, unknown>;
        const assets = resultAny.assets as { large_image?: string } | undefined;
        if (assets?.large_image) {
          // Solo log cada 10 actualizaciones para no saturar
          if (this.activityCount % 10 === 0) {
            Logger.debug(`Discord RPC (#${this.activityCount}): large_image=${assets.large_image.substring(0, 50)}...`);
          }
        } else if (options.largeImageKey) {
          // Enviamos imagen pero Discord no la devolvió - posible problema
          Logger.warn(`Discord RPC: imagen enviada pero no confirmada en respuesta`);
        }
      } else {
        Logger.warn('Discord RPC setActivity devolvió undefined/null');
      }
    } catch (error) {
      Logger.error('Error al establecer actividad en Discord', error as Error);
      this.connected = false; // Marcar como desconectado para reintentar
    }
  }

  /**
   * Limpia la actividad. Si clearActivity() falla silenciosamente,
   * desconecta el RPC para garantizar que Discord elimine la presencia.
   */
  async clearActivity(): Promise<void> {
    if (!this.activityActive) {
      return; // Ya está limpia, no spamear Discord
    }

    try {
      if (this.client.user) {
        await this.client.user.clearActivity();
        this.activityActive = false;
        Logger.info('Actividad de Discord limpiada');
      } else {
        // client.user es null - clearActivity no funcionará, desconectar RPC
        Logger.warn('Discord: client.user no disponible, desconectando RPC para limpiar presencia');
        this.disconnect();
        this.activityActive = false;
      }
    } catch (error) {
      Logger.warn('Error al limpiar actividad, desconectando RPC como fallback');
      this.disconnect();
      this.activityActive = false;
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

  private truncateForDiscord(text?: string): string | undefined {
    if (!text) return undefined;
    return text.length > this.DISCORD_TEXT_LIMIT
      ? `${text.substring(0, this.DISCORD_TEXT_LIMIT - 3)}...`
      : text;
  }
}
