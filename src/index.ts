import { loadConfig } from './config';
import { MpcHcService } from './services/mpc-hc.service';
import { ImgurService } from './services/imgur.service';
import { DiscordService } from './services/discord.service';
import { ImageService } from './services/image.service';
import { cleanFilename } from './utils/helpers';
import Logger from './utils/logger';

let mpcService: MpcHcService;
let imgurService: ImgurService;
let discordService: DiscordService;
let imageService: ImageService;
let isRunning: boolean = true;
let updateIntervalMs: number = 10000;

// Para detectar cambio de archivo
let lastFile: string = '';
// Para refrescar imagen cuando está pausado
let pausedSinceTime: number = 0;
const PAUSED_REFRESH_INTERVAL = 120000; // Refrescar imagen cada 2 minutos si está pausado
const UPDATE_TIMEOUT = 30000; // Timeout máximo para cada ciclo de actualización

async function updateLoopInternal(): Promise<void> {
  const status = await mpcService.getStatus();

  if (!status) {
    Logger.debug('MPC-HC no disponible');
    await discordService.clearActivity();
    return;
  }

  // Detectar cambio de archivo
  const fileChanged = status.file !== lastFile && status.file !== '';
  if (fileChanged) {
    Logger.info(`Cambio de archivo detectado: ${cleanFilename(status.file)}`);
    lastFile = status.file;
  }

  if (status.state === 'playing') {
    // Reset paused timer cuando está reproduciendo
    pausedSinceTime = 0;
    
    // Capturar snapshot
    const snapshot = await mpcService.getSnapshot();

    let imageUrl: string | undefined = imgurService.getLastUrl() || undefined;
    if (snapshot) {
      // Comprimir imagen antes de subir
      const compressed = await imageService.compress(snapshot);
      // Subir (forzar si cambió el archivo)
      const url = await imgurService.upload(compressed, fileChanged);
      if (url) imageUrl = url;
    }

    // Actualizar Discord Rich Presence
    await discordService.setActivity({
      details: cleanFilename(status.file),
      state: `${status.positionString} / ${status.durationString}`,
      largeImageKey: imageUrl,
      largeImageText: status.file
    });

    Logger.info(`Reproduciendo: ${cleanFilename(status.file)} [${status.positionString}]${imageUrl ? '' : ' [SIN IMAGEN]'}`);
  } else if (status.state === 'paused') {
    const now = Date.now();
    let lastImageUrl = imgurService.getLastUrl();
    
    // Iniciar timer de pausa si no está iniciado
    if (pausedSinceTime === 0) {
      pausedSinceTime = now;
    }
    
    // Refrescar imagen si lleva mucho tiempo pausado o no hay imagen
    const pausedDuration = now - pausedSinceTime;
    const needsRefresh = !lastImageUrl || pausedDuration >= PAUSED_REFRESH_INTERVAL;
    
    if (needsRefresh) {
      const snapshot = await mpcService.getSnapshot();
      if (snapshot) {
        const compressed = await imageService.compress(snapshot);
        const url = await imgurService.upload(compressed, true); // Forzar subida
        if (url) {
          lastImageUrl = url;
          pausedSinceTime = now; // Reset timer después de refrescar
          Logger.debug('Imagen refrescada durante pausa');
        }
      }
    }
    
    await discordService.setActivity({
      details: cleanFilename(status.file),
      state: `Pausado - ${status.positionString} / ${status.durationString}`,
      largeImageKey: lastImageUrl || undefined,
      largeImageText: status.file
    });
    Logger.info(`Pausado: ${cleanFilename(status.file)}${lastImageUrl ? '' : ' [SIN IMAGEN]'}`);
  } else {
    await discordService.clearActivity();
    Logger.debug('Detenido');
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
  imgurService = new ImgurService(config.imgur.clientId, config.imgur.uploadInterval);
  discordService = new DiscordService(config.discord.clientId);
  imageService = new ImageService(640, 80); // 640px ancho, 80% calidad

  Logger.info(`Imgur: subida cada ${config.imgur.uploadInterval / 1000} segundos`);
  Logger.info('Compresión de imagen: 640px, calidad 80%');

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
    Logger.error('No se pudo conectar a Discord. Asegúrate de que Discord esté abierto.');
    process.exit(1);
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
