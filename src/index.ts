import { loadConfig } from './config';
import { MpcHcService } from './services/mpc-hc.service';
import { MpvService } from './services/mpv.service';
import { VlcService } from './services/vlc.service';
import { UploadService } from './services/upload.service';
import { DiscordService } from './services/discord.service';
import { ImageService } from './services/image.service';
import { AnilistService } from './services/anilist.service';
import { HistoryService } from './services/history.service';
import { cleanFilename, getActiveMonitorCount, parseAnimeFilename } from './utils/helpers';
import { showWindowsNotification } from './utils/notifier';
import Logger from './utils/logger';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { UploadReason, PlayerService, PlayerStatus } from './types';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Clase para encapsular todo el estado mutable de la aplicación
class AppState {
  // Para detectar cambio de archivo
  lastFile: string = '';
  
  // Tiempo real acumulado reproduciendo el archivo actual (no cuenta pausas)
  playbackElapsedMs: number = 0;
  lastPlayingTickMs: number = 0;
  lastPlayingPositionMs: number = 0;
  
  // Para refrescar imagen cuando está pausado
  pausedSinceTime: number = 0;
  lastPausedSnapshot: Buffer | null = null; // Guardar snapshot de pausa para re-subir
  pauseRefreshCount: number = 0; // Contador de refreshes durante pausa
  lastState: string = ''; // Para detectar cambio de estado (paused -> playing)
  
  // Historial de capturas para Smart Thumbnail (Feature 10)
  snapshotHistory: Array<{ buffer: Buffer; brightness: number }> = [];
  
  // Configuración dinámica
  isRunning: boolean = true;
  updateIntervalMs: number = 10000;
  autoRestartDiscord: boolean = false;
  discordRestartThreshold: number = 60;
  defaultButtons?: Array<{ label: string; url: string }>;
  
  // Para detección automática de monitores
  flipVerticalMode: boolean | 'auto' = 'auto';
  lastMonitorCount: number = 1;
  lastMonitorCheck: number = 0;

  resetForNewFile(filename: string): void {
    this.lastFile = filename;
    this.lastPausedSnapshot = null;
    this.playbackElapsedMs = 0;
    this.lastPlayingTickMs = 0;
    this.lastPlayingPositionMs = 0;
    this.snapshotHistory = []; // Limpiar historial de Smart Thumbnail para el nuevo archivo
  }

  resetForPause(now: number, compressedSnapshot: Buffer | null): void {
    this.pausedSinceTime = now;
    this.pauseRefreshCount = 0;
    this.lastPausedSnapshot = compressedSnapshot;
  }

  resetForPlaying(): void {
    this.pausedSinceTime = 0;
    this.lastPausedSnapshot = null;
    this.pauseRefreshCount = 0;
    this.lastState = 'playing';
  }

  /**
   * Agrega un snapshot al historial de Smart Thumbnail
   */
  addSnapshot(buffer: Buffer, brightness: number): void {
    this.snapshotHistory.push({ buffer, brightness });
    if (this.snapshotHistory.length > 3) {
      this.snapshotHistory.shift(); // Mantener solo las últimas 3 capturas
    }
  }

  /**
   * Obtiene la mejor captura (evita escenas oscuras en transiciones)
   */
  getBestSnapshot(currentBuffer: Buffer, currentBrightness: number): Buffer {
    // Si la captura actual tiene buen brillo (>= 40 de 255), la usamos y la guardamos
    if (currentBrightness >= 40) {
      this.addSnapshot(currentBuffer, currentBrightness);
      return currentBuffer;
    }
    
    // Si es muy oscura, intentamos buscar una mejor en el historial reciente
    let best = { buffer: currentBuffer, brightness: currentBrightness };
    for (const snap of this.snapshotHistory) {
      if (snap.brightness > best.brightness) {
        best = snap;
      }
    }
    
    if (best.brightness > currentBrightness) {
      Logger.debug(`Smart Thumbnail: Reemplazado frame oscuro (${Math.round(currentBrightness)}) por uno más claro del historial (${Math.round(best.brightness)})`);
      return best.buffer;
    }
    
    // Si no hay nada mejor, usar la actual y guardarla
    this.addSnapshot(currentBuffer, currentBrightness);
    return currentBuffer;
  }
}

const state = new AppState();

let uploadService: UploadService;
let discordService: DiscordService;
let imageService: ImageService;
let anilistService: AnilistService;
let historyService: HistoryService;
let trayProcess: any = null;

// Lista de reproductores soportados en orden de prioridad
let players: PlayerService[] = [];
let activePlayer: PlayerService | null = null;

const PLAYBACK_POSITION_TOLERANCE_MS = 1500; // Tolerancia por jitter de posición/reportes
const PAUSED_REFRESH_INTERVAL = 300000; // Refrescar imagen cada 5 min si está pausado
const PAUSED_REFRESH_START_DELAY = 180000; // Empezar refresh de pausa después de 3 min
const UPDATE_TIMEOUT = 30000; // Timeout máximo para cada ciclo de actualización
const RESUME_THRESHOLD = 60000; // Si estuvo pausado más de 1 min, forzar refresh al reanudar
const RESUME_FORCE_UPLOAD_DEBOUNCE_MS = 120000; // No forzar subida en resume si hubo una reciente

// Timeouts para reinicio de Discord
const DISCORD_KILL_DELAY_MS = 2000; // Espera después de matar el proceso
const DISCORD_STARTUP_WAIT_MS = 8000; // Espera para que Discord inicie

// Cache de detección de monitores
const MONITOR_CHECK_INTERVAL = 60000; // Verificar cada 60 segundos

function buildDiscordState(baseState: string): string {
  const rateLimitStatus = uploadService.getRateLimitStatus();
  if (!rateLimitStatus.active) {
    return baseState;
  }
  return `${baseState} | Imgur 429 (${rateLimitStatus.remainingSeconds}s)`;
}

async function checkMonitorFlip(): Promise<void> {
  if (state.flipVerticalMode !== 'auto') return;
  
  const now = Date.now();
  if (now - state.lastMonitorCheck < MONITOR_CHECK_INTERVAL) return;
  state.lastMonitorCheck = now;
  
  const monitorCount = await getActiveMonitorCount();
  if (monitorCount !== state.lastMonitorCount) {
    state.lastMonitorCount = monitorCount;
    const shouldFlip = monitorCount > 1;
    imageService.setFlipVertical(shouldFlip);
    Logger.info(`Monitores activos: ${monitorCount} - Flip vertical: ${shouldFlip ? 'activado' : 'desactivado'}`);
  }
}

async function detectPlayer(): Promise<PlayerService | null> {
  // Si el reproductor activo sigue conectado, mantenerlo
  if (activePlayer && (await activePlayer.isConnected())) {
    return activePlayer;
  }

  // Si se desconectó, avisar
  if (activePlayer) {
    Logger.info(`Reproductor "${activePlayer.name}" se ha desconectado.`);
    showWindowsNotification("Reproductor Desconectado", `Se cerró la sesión con ${activePlayer.name}`);
    activePlayer = null;
    historyService.endSession();
  }

  // Buscar el primer reproductor disponible
  for (const player of players) {
    if (await player.isConnected()) {
      activePlayer = player;
      Logger.info(`¡Conectado al reproductor: "${player.name}"!`);
      showWindowsNotification("Reproductor Conectado", `Vinculado exitosamente con ${player.name}`);
      return player;
    }
  }

  return null;
}

async function updateLoopInternal(): Promise<void> {
  // Verificar monitores para flip automático
  await checkMonitorFlip();
  
  // Auto-detectar reproductor activo
  const player = await detectPlayer();

  if (!player) {
    state.lastPlayingTickMs = 0; // Congelar contador
    Logger.debug('Ningún reproductor activo detectado (MPC-HC, mpv o VLC)');
    await discordService.clearActivity();
    return;
  }

  const status = await player.getStatus();

  if (!status) {
    state.lastPlayingTickMs = 0;
    Logger.debug(`No se pudo obtener el estado de ${player.name}`);
    await discordService.clearActivity();
    return;
  }

  // Reconectar a Discord si no está conectado
  if (!discordService.isConnected()) {
    Logger.info('Reconectando a Discord RPC...');
    await discordService.connect();
    if (!discordService.isConnected()) {
      Logger.debug('Discord no disponible, reintentando en próximo ciclo');
      return;
    }
  }

  // Detectar cambio de archivo
  const fileChanged = status.file !== state.lastFile && status.file !== '';
  if (fileChanged) {
    Logger.info(`Cambio de archivo detectado: ${cleanFilename(status.file)}`);
    state.resetForNewFile(status.file);
    historyService.startSession(status.file);
  }

  if (status.state === 'playing') {
    const now = Date.now();
    // Detectar si viene de una pausa
    const wasPaused = state.lastState === 'paused' && state.pausedSinceTime > 0;
    const pauseDurationMs = wasPaused ? now - state.pausedSinceTime : 0;
    const wasLongPause = wasPaused && pauseDurationMs > RESUME_THRESHOLD;
    const lastUploadAgeMs = uploadService.getLastUploadAgeMs();
    const shouldForceResumeUpload = wasLongPause
      && (lastUploadAgeMs === null || lastUploadAgeMs >= RESUME_FORCE_UPLOAD_DEBOUNCE_MS);
    
    if (wasLongPause) {
      const pauseDuration = Math.floor(pauseDurationMs / 1000);
      Logger.info(`Resume detectado después de ${pauseDuration}s de pausa - forzando reconexión de Discord`);
      await discordService.forceReconnect(); // Reconectar Discord RPC
      if (!shouldForceResumeUpload && lastUploadAgeMs !== null) {
        Logger.info(`Debounce de resume activo: omitiendo subida forzada (última subida hace ${Math.floor(lastUploadAgeMs / 1000)}s)`);
      }
    }
    
    if (state.lastState !== 'playing' || state.lastPlayingTickMs === 0) {
      state.lastPlayingTickMs = now;
      state.lastPlayingPositionMs = status.position;
    } else {
      const wallDelta = now - state.lastPlayingTickMs;
      const positionDelta = Math.max(0, status.position - state.lastPlayingPositionMs);
      const elapsedIncrement = Math.min(wallDelta, positionDelta + PLAYBACK_POSITION_TOLERANCE_MS);
      state.playbackElapsedMs += Math.max(0, elapsedIncrement);
      state.lastPlayingTickMs = now;
      state.lastPlayingPositionMs = status.position;
    }
    const playbackStartTimestamp = now - state.playbackElapsedMs;
    
    // Actualizar historial local de reproducción
    historyService.updateProgress(state.playbackElapsedMs);
    
    // Reset paused timer y snapshot cuando está reproduciendo
    state.resetForPlaying();
    discordService.setPausedState(false);
    
    // 1. Obtener metadata de AniList para enriquecer la presencia
    let smallImageUrl: string | undefined;
    let smallImageText: string = status.file;
    let buttons: Array<{ label: string; url: string }> | undefined;

    const parsedAnime = parseAnimeFilename(status.file);
    let anilistInfo = null;
    if (parsedAnime) {
      anilistInfo = await anilistService.searchAnime(parsedAnime.title);
    }

    if (anilistInfo) {
      smallImageUrl = anilistInfo.coverImage.large;
      smallImageText = anilistInfo.title.english || anilistInfo.title.romaji;
      
      buttons = [{ label: 'Ver en AniList', url: anilistInfo.siteUrl }];
      
      if (state.defaultButtons) {
        for (const btn of state.defaultButtons) {
          if (buttons.length < 2) {
            buttons.push(btn);
          }
        }
      }
    } else {
      if (state.defaultButtons) {
        buttons = [...state.defaultButtons];
      }
    }

    // 2. Captura y subida del thumbnail en vivo (función principal)
    const snapshot = await player.getSnapshot();
    let imageUrl: string | undefined = uploadService.getLastUrl() || undefined;
    
    if (snapshot) {
      const compressed = await imageService.compress(snapshot);
      const brightness = await imageService.getBrightness(compressed);
      
      // Smart Thumbnail: Elegir la mejor captura si la actual es muy oscura
      const bestSnapshot = state.getBestSnapshot(compressed, brightness);
      
      const forceReason = fileChanged ? UploadReason.FILE_CHANGE : (shouldForceResumeUpload ? UploadReason.RESUME : undefined);
      const url = await uploadService.upload(bestSnapshot, fileChanged || shouldForceResumeUpload, forceReason);
      if (url) imageUrl = url;
    }

    // Actualizar Discord Rich Presence
    await discordService.setActivity({
      details: cleanFilename(status.file),
      state: buildDiscordState(`${status.positionString} / ${status.durationString}`),
      largeImageKey: imageUrl, // Thumbnail en vivo
      largeImageText: cleanFilename(status.file),
      smallImageKey: smallImageUrl, // Portada de AniList como ícono secundario
      smallImageText: smallImageText,
      startTimestamp: playbackStartTimestamp,
      buttons: buttons
    });

    Logger.info(`[${player.name}] Reproduciendo: ${cleanFilename(status.file)} [${status.positionString}]${imageUrl ? ' [Live Thumbnail]' : ' [SIN IMAGEN]'}${anilistInfo ? ' [AniList Badge]' : ''}`);
  } else if (status.state === 'paused') {
    const now = Date.now();
    let lastImageUrl = uploadService.getLastUrl();
    state.lastState = 'paused';
    state.lastPlayingTickMs = 0; // Congelar contador durante pausa
    state.lastPlayingPositionMs = status.position;
    discordService.setPausedState(true);
    
    // Obtener metadata de AniList
    const parsedAnime = parseAnimeFilename(status.file);
    let anilistInfo = null;
    if (parsedAnime) {
      anilistInfo = await anilistService.searchAnime(parsedAnime.title);
    }

    let smallImageUrl: string | undefined;
    let smallImageText = status.file;
    let buttons: Array<{ label: string; url: string }> | undefined;

    if (anilistInfo) {
      smallImageUrl = anilistInfo.coverImage.large;
      smallImageText = anilistInfo.title.english || anilistInfo.title.romaji;
      buttons = [{ label: 'Ver en AniList', url: anilistInfo.siteUrl }];
      if (state.defaultButtons) {
        for (const btn of state.defaultButtons) {
          if (buttons.length < 2) {
            buttons.push(btn);
          }
        }
      }
    } else {
      if (state.defaultButtons) {
        buttons = [...state.defaultButtons];
      }
    }

    // Iniciar timer de pausa si no está iniciado
    if (state.pausedSinceTime === 0) {
      const snapshot = await player.getSnapshot();
      let compressedSnapshot: Buffer | null = null;
      if (snapshot) {
        compressedSnapshot = await imageService.compress(snapshot);
      }
      state.resetForPause(now, compressedSnapshot);
    }
    
    // Refrescar imagen periódicamente durante pausa
    const pausedDuration = now - state.pausedSinceTime;
    const hasReachedPausedRefreshWindow = pausedDuration >= PAUSED_REFRESH_START_DELAY;
    const refreshNumber = hasReachedPausedRefreshWindow
      ? Math.floor((pausedDuration - PAUSED_REFRESH_START_DELAY) / PAUSED_REFRESH_INTERVAL) + 1
      : 0;
    const needsRefresh = hasReachedPausedRefreshWindow && (!lastImageUrl || refreshNumber > state.pauseRefreshCount);
    
    if (needsRefresh) {
      let snapshotToUpload = state.lastPausedSnapshot;
      
      if (!snapshotToUpload) {
        const snapshot = await player.getSnapshot();
        if (snapshot) {
          snapshotToUpload = await imageService.compress(snapshot);
          state.lastPausedSnapshot = snapshotToUpload;
        }
      }
      
      if (snapshotToUpload) {
        const url = await uploadService.upload(snapshotToUpload, true, UploadReason.PAUSED_REFRESH);
        if (url) {
          lastImageUrl = url;
          state.pauseRefreshCount = refreshNumber;
          Logger.debug(`Imagen refrescada durante pausa (#${state.pauseRefreshCount})`);
        }
      }
    }
    
    await discordService.setActivity({
      details: cleanFilename(status.file),
      state: buildDiscordState(`Pausado - ${status.positionString} / ${status.durationString}`),
      largeImageKey: lastImageUrl || undefined,
      largeImageText: cleanFilename(status.file),
      smallImageKey: smallImageUrl,
      smallImageText: smallImageText,
      buttons: buttons
    });
    Logger.info(`[${player.name}] Pausado: ${cleanFilename(status.file)}${lastImageUrl ? '' : ' [SIN IMAGEN]'}${anilistInfo ? ' [AniList Badge]' : ''}`);
  } else {
    state.lastState = 'stopped';
    state.lastPlayingTickMs = 0;
    state.lastPlayingPositionMs = status.position;
    discordService.setPausedState(false);
    await discordService.clearActivity();
    historyService.endSession(); // Cerrar historial al detener
    Logger.debug('Detenido');
  }

  // Verificar si necesitamos reiniciar Discord por rate limit
  await checkDiscordRestart();
}

async function restartDiscord(): Promise<void> {
  Logger.info('Reiniciando Discord para evitar rate limit de imágenes...');
  showWindowsNotification("Reiniciando Discord", "Se reiniciará el cliente Discord para evitar el rate limit de imágenes externas.");
  
  discordService.disconnect();
  
  try {
    await execFileAsync('taskkill', ['/IM', 'Discord.exe', '/F']);
  } catch (error) {
    Logger.warn('No se pudo cerrar Discord (puede que ya estuviera cerrado)');
  }
  
  await new Promise(resolve => setTimeout(resolve, DISCORD_KILL_DELAY_MS));
  
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

  await new Promise(resolve => setTimeout(resolve, DISCORD_STARTUP_WAIT_MS));
  
  const connected = await discordService.connect();
  if (connected) {
    Logger.info('Reconectado a Discord RPC después del reinicio');
    uploadService.resetUniqueImageCount();
  } else {
    Logger.error('No se pudo reconectar a Discord RPC');
  }
}

async function checkDiscordRestart(): Promise<void> {
  if (!state.autoRestartDiscord) return;
  
  const imageCount = uploadService.getUniqueImageCount();
  if (imageCount >= state.discordRestartThreshold) {
    Logger.info(`Límite de imágenes alcanzado (${imageCount}/${state.discordRestartThreshold}) - reiniciando Discord`);
    await restartDiscord();
  }
}

async function updateLoop(): Promise<void> {
  try {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timeout en updateLoop')), UPDATE_TIMEOUT);
    });
    
    await Promise.race([updateLoopInternal(), timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
  } catch (error) {
    Logger.error('Error en updateLoop', error as Error);
  }
}

function startSystemTray(): void {
  const trayScriptPath = path.join(process.cwd(), 'scripts', 'tray.ps1');
  if (!fs.existsSync(trayScriptPath)) {
    Logger.warn('No se encontró el script de bandeja del sistema scripts/tray.ps1');
    return;
  }

  const logPath = Logger.getLogFilePath();
  const historyPath = path.join(process.cwd(), 'data', 'history.json');

  trayProcess = spawn('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-File',
    trayScriptPath,
    '-NodePid',
    process.pid.toString(),
    '-LogPath',
    logPath,
    '-HistoryPath',
    historyPath
  ], {
    detached: true,
    stdio: 'ignore'
  });
  trayProcess.unref();
  Logger.info('Bandeja de sistema: Ícono iniciado en segundo plano.');
}

async function main(): Promise<void> {
  console.log('=================================');
  console.log(' MPC Discord Rich Presence Plus');
  console.log('=================================\n');

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    Logger.error('Error de configuración', error as Error);
    Logger.info('Copia .env.example a .env y configura tus credenciales');
    process.exit(1);
  }

  // Inicializar reproductores soportados
  players = [
    new MpcHcService(config.mpc.host, config.mpc.port),
    new MpvService(),
    new VlcService(config.vlc.host, config.vlc.port, config.vlc.password)
  ];

  // Inicializar servicios
  uploadService = new UploadService(
    config.imgur.provider,
    config.imgur.clientId,
    config.imgur.uploadInterval,
    config.discord.restartThreshold,
    config.imgur.imgbbApiKey
  );
  discordService = new DiscordService(config.discord.clientId, config.discord.buttons);
  imageService = new ImageService(config.image.maxWidth, config.image.quality, config.flipThumbnail, config.flipVertical);
  anilistService = new AnilistService(config.anilist.enabled);
  historyService = new HistoryService();

  Logger.info(`Proveedor de subida: ${config.imgur.provider}`);
  Logger.info(`Intervalo de subida: ${config.imgur.uploadInterval / 1000} segundos`);
  Logger.info(`Compresión de imagen: ${config.image.maxWidth}px, calidad ${config.image.quality}%`);
  
  state.defaultButtons = config.discord.buttons;
  if (config.discord.buttons) {
    Logger.info(`Botones configurados: ${config.discord.buttons.map(b => b.label).join(', ')}`);
  }
  
  if (config.anilist.enabled) {
    Logger.info('Enriquecimiento AniList: activado');
  }
  
  state.flipVerticalMode = config.flipVertical;
  if (config.flipVertical === 'auto') {
    const monitorCount = await getActiveMonitorCount();
    state.lastMonitorCount = monitorCount;
    const shouldFlip = monitorCount > 1;
    imageService.setFlipVertical(shouldFlip);
    Logger.info(`Flip vertical: AUTO (${monitorCount} monitores - ${shouldFlip ? 'activado' : 'desactivado'})`);
  } else if (config.flipVertical) {
    Logger.info('Flip vertical: activado (forzado)');
  }
  
  state.autoRestartDiscord = config.discord.autoRestart;
  state.discordRestartThreshold = config.discord.restartThreshold;
  if (state.autoRestartDiscord) {
    Logger.info(`Auto-reinicio de Discord: activado (cada ${state.discordRestartThreshold} imágenes)`);
  }

  const discordConnected = await discordService.connect();
  if (!discordConnected) {
    Logger.warn('No se pudo conectar a Discord al iniciar. Se reintentará en el loop.');
  }

  // Lanzar la bandeja del sistema (System Tray Icon)
  startSystemTray();

  // Mostrar notificación de Windows al iniciar
  showWindowsNotification("MPC Discord Presence", "La aplicación ha iniciado y está buscando reproductores en segundo plano.");

  Logger.info(`Actualizando cada ${config.updateInterval / 1000} segundos\n`);
  state.updateIntervalMs = config.updateInterval;
  scheduleNextUpdate();
}

function scheduleNextUpdate(): void {
  if (!state.isRunning) return;
  
  updateLoop().finally(() => {
    if (state.isRunning) {
      setTimeout(scheduleNextUpdate, state.updateIntervalMs);
    }
  });
}

async function shutdown(signal: string): Promise<void> {
  Logger.info(`\n${signal} recibido, cerrando...`);
  state.isRunning = false;
  
  // Cerrar el proceso de la bandeja del sistema
  if (trayProcess) {
    try {
      process.kill(trayProcess.pid);
    } catch {}
  }
  
  try {
    historyService.endSession(); // Guardar sesión final
    await discordService.clearActivity();
    discordService.disconnect();
  } catch (error) {
    Logger.error('Error durante shutdown', error as Error);
  } finally {
    Logger.close();
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  Logger.error(`Promesa no manejada: ${message}`);
});

main().catch((error) => {
  Logger.error('Error fatal', error);
  process.exit(1);
});
