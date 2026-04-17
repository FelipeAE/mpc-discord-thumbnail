import { loadConfig } from './config';
import { MpcHcService } from './services/mpc-hc.service';
import { ImgurService } from './services/imgur.service';
import { DiscordService } from './services/discord.service';
import { ImageService } from './services/image.service';
import { cleanFilename, getActiveMonitorCount } from './utils/helpers';
import Logger from './utils/logger';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

let mpcService: MpcHcService;
let imgurService: ImgurService;
let discordService: DiscordService;
let imageService: ImageService;
let isRunning: boolean = true;
let updateIntervalMs: number = 10000;

// Para detectar cambio de archivo
let lastFile: string = '';
// Tiempo real acumulado reproduciendo el archivo actual (no cuenta pausas)
let playbackElapsedMs: number = 0;
let lastPlayingTickMs: number = 0;
let lastPlayingPositionMs: number = 0;
// Para refrescar imagen cuando está pausado
let pausedSinceTime: number = 0;
let lastPausedSnapshot: Buffer | null = null; // Guardar snapshot de pausa para re-subir si es necesario
let pauseRefreshCount: number = 0; // Contador de refreshes durante pausa
let lastState: string = ''; // Para detectar cambio de estado (paused -> playing)
const PLAYBACK_POSITION_TOLERANCE_MS = 1500; // Tolerancia por jitter de posición/reportes
const PAUSED_REFRESH_INTERVAL = 60000; // Refrescar imagen cada 1 min si está pausado
const UPDATE_TIMEOUT = 30000; // Timeout máximo para cada ciclo de actualización
const RESUME_THRESHOLD = 60000; // Si estuvo pausado más de 1 min, forzar refresh al reanudar

// Configuración de reinicio automático de Discord
let autoRestartDiscord: boolean = false;
let discordRestartThreshold: number = 60;

// Para detección automática de monitores
let flipVerticalMode: boolean | 'auto' = 'auto';
let lastMonitorCount: number = 1;

// Cache de detección de monitores (no verificar en cada ciclo)
let lastMonitorCheck: number = 0;
const MONITOR_CHECK_INTERVAL = 60000; // Verificar cada 60 segundos

function buildDiscordState(baseState: string): string {
  const rateLimitStatus = imgurService.getRateLimitStatus();
  if (!rateLimitStatus.active) {
    return baseState;
  }
  return `${baseState} | Imgur 429 (${rateLimitStatus.remainingSeconds}s)`;
}

async function checkMonitorFlip(): Promise<void> {
  if (flipVerticalMode !== 'auto') return;
  
  // Solo verificar cada MONITOR_CHECK_INTERVAL
  const now = Date.now();
  if (now - lastMonitorCheck < MONITOR_CHECK_INTERVAL) return;
  lastMonitorCheck = now;
  
  const monitorCount = await getActiveMonitorCount();
  if (monitorCount !== lastMonitorCount) {
    lastMonitorCount = monitorCount;
    const shouldFlip = monitorCount > 1;
    imageService.setFlipVertical(shouldFlip);
    Logger.info(`Monitores activos: ${monitorCount} - Flip vertical: ${shouldFlip ? 'activado' : 'desactivado'}`);
  }
}

async function updateLoopInternal(): Promise<void> {
  // Verificar monitores para flip automático
  await checkMonitorFlip();
  
  const status = await mpcService.getStatus();

  if (!status) {
    lastPlayingTickMs = 0; // Congelar contador si MPC-HC no responde
    Logger.debug('MPC-HC no disponible');
    await discordService.clearActivity();
    return;
  }

  // Reconectar a Discord si no está conectado (e.g., después de limpiar presencia por MPC-HC cerrado)
  if (!discordService.isConnected()) {
    Logger.info('Reconectando a Discord RPC (MPC-HC disponible de nuevo)...');
    await discordService.connect();
    if (!discordService.isConnected()) {
      Logger.debug('Discord no disponible, reintentando en próximo ciclo');
      return;
    }
  }

  // Detectar cambio de archivo
  const fileChanged = status.file !== lastFile && status.file !== '';
  if (fileChanged) {
    Logger.info(`Cambio de archivo detectado: ${cleanFilename(status.file)}`);
    lastFile = status.file;
    lastPausedSnapshot = null; // Reset snapshot al cambiar archivo
    playbackElapsedMs = 0;
    lastPlayingTickMs = 0;
    lastPlayingPositionMs = 0;
  }

  if (status.state === 'playing') {
    // Detectar si viene de una pausa
    const wasPaused = lastState === 'paused' && pausedSinceTime > 0;
    const pauseDurationMs = wasPaused ? Date.now() - pausedSinceTime : 0;
    const wasLongPause = wasPaused && pauseDurationMs > RESUME_THRESHOLD;
    
    if (wasLongPause) {
      const pauseDuration = Math.floor(pauseDurationMs / 1000);
      Logger.info(`Resume detectado después de ${pauseDuration}s de pausa - forzando refresh`);
      await discordService.forceReconnect(); // Reconectar Discord RPC
    }
    
    const now = Date.now();
    if (lastState !== 'playing' || lastPlayingTickMs === 0) {
      // Primer tick de reproducción (o resume): iniciar referencia sin sumar de golpe.
      lastPlayingTickMs = now;
      lastPlayingPositionMs = status.position;
    } else {
      const wallDelta = now - lastPlayingTickMs;
      const positionDelta = Math.max(0, status.position - lastPlayingPositionMs);
      const elapsedIncrement = Math.min(wallDelta, positionDelta + PLAYBACK_POSITION_TOLERANCE_MS);
      playbackElapsedMs += Math.max(0, elapsedIncrement);
      lastPlayingTickMs = now;
      lastPlayingPositionMs = status.position;
    }
    const playbackStartTimestamp = now - playbackElapsedMs;
    
    // Reset paused timer y snapshot cuando está reproduciendo
    pausedSinceTime = 0;
    lastPausedSnapshot = null;
    pauseRefreshCount = 0;
    lastState = 'playing';
    discordService.setPausedState(false); // Notificar a Discord que no está pausado
    
    // Capturar snapshot
    const snapshot = await mpcService.getSnapshot();

    let imageUrl: string | undefined = imgurService.getLastUrl() || undefined;
    if (snapshot) {
      // Comprimir imagen antes de subir
      const compressed = await imageService.compress(snapshot);
      // Subir (forzar si cambió el archivo O si viene de pausa larga)
      const forceReason = fileChanged ? 'cambio de archivo' : (wasLongPause ? 'resume después de pausa' : undefined);
      const url = await imgurService.upload(compressed, fileChanged || wasLongPause, forceReason);
      if (url) imageUrl = url;
    }

    // Actualizar Discord Rich Presence
    await discordService.setActivity({
      details: cleanFilename(status.file),
      state: buildDiscordState(`${status.positionString} / ${status.durationString}`),
      largeImageKey: imageUrl,
      largeImageText: status.file,
      startTimestamp: playbackStartTimestamp
    });

    Logger.info(`Reproduciendo: ${cleanFilename(status.file)} [${status.positionString}]${imageUrl ? '' : ' [SIN IMAGEN]'}`);
  } else if (status.state === 'paused') {
    const now = Date.now();
    let lastImageUrl = imgurService.getLastUrl();
    lastState = 'paused';
    lastPlayingTickMs = 0; // Congelar contador durante pausa
    lastPlayingPositionMs = status.position;
    discordService.setPausedState(true); // Notificar a Discord que está pausado
    
    // NO resetear timestamp al pausar - mantener el tiempo acumulado
    
    // Iniciar timer de pausa si no está iniciado
    if (pausedSinceTime === 0) {
      pausedSinceTime = now;
      pauseRefreshCount = 0;
      // Capturar snapshot inicial de pausa
      const snapshot = await mpcService.getSnapshot();
      if (snapshot) {
        lastPausedSnapshot = await imageService.compress(snapshot);
      }
    }
    
    // Refrescar imagen periódicamente durante pausa para mantenerla visible
    const pausedDuration = now - pausedSinceTime;
    const refreshNumber = Math.floor(pausedDuration / PAUSED_REFRESH_INTERVAL);
    const needsRefresh = !lastImageUrl || refreshNumber > pauseRefreshCount;
    
    if (needsRefresh) {
      // Usar el snapshot guardado de pausa (misma imagen, nueva URL para evitar cache)
      let snapshotToUpload = lastPausedSnapshot;
      
      // Si no hay snapshot guardado, capturar uno nuevo
      if (!snapshotToUpload) {
        const snapshot = await mpcService.getSnapshot();
        if (snapshot) {
          snapshotToUpload = await imageService.compress(snapshot);
          lastPausedSnapshot = snapshotToUpload;
        }
      }
      
      if (snapshotToUpload) {
        const url = await imgurService.upload(snapshotToUpload, true, 'refresh durante pausa'); // Forzar subida con nueva URL
        if (url) {
          lastImageUrl = url;
          pauseRefreshCount = refreshNumber;
          Logger.debug(`Imagen refrescada durante pausa (#${pauseRefreshCount})`);
        }
      }
    }
    
    await discordService.setActivity({
      details: cleanFilename(status.file),
      state: buildDiscordState(`Pausado - ${status.positionString} / ${status.durationString}`),
      largeImageKey: lastImageUrl || undefined,
      largeImageText: status.file
    });
    Logger.info(`Pausado: ${cleanFilename(status.file)}${lastImageUrl ? '' : ' [SIN IMAGEN]'}`);
  } else {
    lastState = 'stopped';
    lastPlayingTickMs = 0;
    lastPlayingPositionMs = 0;
    discordService.setPausedState(false);
    await discordService.clearActivity();
    Logger.debug('Detenido');
  }

  // Verificar si necesitamos reiniciar Discord por rate limit de imágenes
  await checkDiscordRestart();
}

async function restartDiscord(): Promise<void> {
  Logger.info('Reiniciando Discord para evitar rate limit de imágenes...');
  
  // Desconectar RPC primero
  discordService.disconnect();
  
  return new Promise((resolve) => {
    // Cerrar Discord con argumentos fijos (sin shell)
    execFile('taskkill', ['/IM', 'Discord.exe', '/F'], (error) => {
      if (error) {
        Logger.warn('No se pudo cerrar Discord (puede que ya estuviera cerrado)');
      }
      
      // Esperar un momento y reiniciar Discord
      setTimeout(() => {
        let started = false;
        try {
          const localAppData = process.env.LOCALAPPDATA;
          if (localAppData) {
            const updateExePath = path.join(localAppData, 'Discord', 'Update.exe');
            if (fs.existsSync(updateExePath)) {
              const child = spawn(updateExePath, ['--processStart', 'Discord.exe'], {
                detached: true,
                stdio: 'ignore'
              });
              child.unref();
              started = true;
            }
          }
        } catch (startError) {
          Logger.warn(`No se pudo iniciar Discord automáticamente: ${(startError as Error).message}`);
        }

        if (!started) {
          Logger.warn('No se pudo iniciar Discord automáticamente. Por favor, ábrelo manualmente.');
        } else {
          Logger.info('Discord reiniciado. Esperando reconexión...');
        }

        (async () => {
          // Esperar a que Discord inicie
          await new Promise(r => setTimeout(r, 8000));
          
          // Reconectar RPC
          const connected = await discordService.connect();
          if (connected) {
            Logger.info('Reconectado a Discord RPC después del reinicio');
            imgurService.resetUniqueImageCount();
          } else {
            Logger.error('No se pudo reconectar a Discord RPC');
          }
          
          resolve();
        })();
      }, 2000);
    });
  });
}

async function checkDiscordRestart(): Promise<void> {
  if (!autoRestartDiscord) return;
  
  const imageCount = imgurService.getUniqueImageCount();
  if (imageCount >= discordRestartThreshold) {
    Logger.info(`Límite de imágenes alcanzado (${imageCount}/${discordRestartThreshold}) - reiniciando Discord`);
    await restartDiscord();
  }
}

async function updateLoop(): Promise<void> {
  try {
    // Agregar timeout para evitar que el loop se congele
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout en updateLoop')), UPDATE_TIMEOUT);
    });
    
    await Promise.race([updateLoopInternal(), timeoutPromise]);
  } catch (error) {
    Logger.error('Error en updateLoop', error as Error);
  }
}

async function main(): Promise<void> {
  console.log('=================================');
  console.log(' MPC-HC Discord Rich Presence');
  console.log('=================================\n');

  // Cargar configuración
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    Logger.error('Error de configuración', error as Error);
    Logger.info('Copia .env.example a .env y configura tus credenciales');
    process.exit(1);
  }

  // Inicializar servicios
  mpcService = new MpcHcService(config.mpc.host, config.mpc.port);
  imgurService = new ImgurService(config.imgur.clientId, config.imgur.uploadInterval, config.discord.restartThreshold);
  discordService = new DiscordService(config.discord.clientId);
  imageService = new ImageService(640, 80, config.flipThumbnail, config.flipVertical); // 640px ancho, 80% calidad

  Logger.info(`Imgur: subida cada ${config.imgur.uploadInterval / 1000} segundos (${config.imgur.uploadInterval / 60000} min)`);
  Logger.info(`Rate limit estimado: ${config.discord.restartThreshold} imágenes = ${(config.discord.restartThreshold * config.imgur.uploadInterval / 60000)} min`);
  Logger.info('Compresión de imagen: 640px, calidad 80%');
  if (config.flipThumbnail) {
    Logger.info('Flip horizontal activado (fix para multi-monitor)');
  }
  
  // Configurar modo de flip vertical
  flipVerticalMode = config.flipVertical;
  if (config.flipVertical === 'auto') {
    const monitorCount = await getActiveMonitorCount();
    lastMonitorCount = monitorCount;
    const shouldFlip = monitorCount > 1;
    imageService.setFlipVertical(shouldFlip);
    Logger.info(`Flip vertical: AUTO (${monitorCount} monitor${monitorCount > 1 ? 'es' : ''} - ${shouldFlip ? 'activado' : 'desactivado'})`);
  } else if (config.flipVertical) {
    Logger.info('Flip vertical: activado (forzado)');
  }
  
  // Configurar reinicio automático de Discord
  autoRestartDiscord = config.discord.autoRestart;
  discordRestartThreshold = config.discord.restartThreshold;
  if (autoRestartDiscord) {
    Logger.info(`Auto-reinicio de Discord: activado (cada ${discordRestartThreshold} imágenes)`);
  }

  // Verificar conexión con MPC-HC
  const mpcConnected = await mpcService.isConnected();
  if (mpcConnected) {
    Logger.info(`MPC-HC conectado en ${config.mpc.host}:${config.mpc.port}`);
  } else {
    Logger.warn('MPC-HC no está corriendo. Se reintentará automáticamente.');
  }

  // Conectar a Discord
  const discordConnected = await discordService.connect();
  if (!discordConnected) {
    Logger.warn('No se pudo conectar a Discord al iniciar. Se reintentará automáticamente en el loop.');
  }

  // Iniciar loop de actualización
  Logger.info(`Actualizando cada ${config.updateInterval / 1000} segundos\n`);
  updateIntervalMs = config.updateInterval;
  scheduleNextUpdate(); // Iniciar el loop
}

function scheduleNextUpdate(): void {
  if (!isRunning) return;
  
  updateLoop().finally(() => {
    if (isRunning) {
      setTimeout(scheduleNextUpdate, updateIntervalMs);
    }
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  Logger.info('\nCerrando...');
  isRunning = false;
  await discordService.clearActivity();
  discordService.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  isRunning = false;
  await discordService.clearActivity();
  discordService.disconnect();
  process.exit(0);
});

// Ejecutar
main().catch((error) => {
  Logger.error('Error fatal', error);
  process.exit(1);
});
