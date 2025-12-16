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
let updateInterval: NodeJS.Timeout | null = null;

// Para detectar cambio de archivo
let lastFile: string = '';

async function updateLoop(): Promise<void> {
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
    // Capturar snapshot
    const snapshot = await mpcService.getSnapshot();

    let imageUrl: string | undefined;
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

    Logger.info(`Reproduciendo: ${cleanFilename(status.file)} [${status.positionString}]`);
  } else if (status.state === 'paused') {
    // Usar la última imagen subida cuando está pausado
    const lastImageUrl = imgurService.getLastUrl();
    await discordService.setActivity({
      details: cleanFilename(status.file),
      state: `Pausado - ${status.positionString} / ${status.durationString}`,
      largeImageKey: lastImageUrl || undefined,
      largeImageText: status.file
    });
    Logger.info(`Pausado: ${cleanFilename(status.file)}`);
  } else {
    await discordService.clearActivity();
    Logger.debug('Detenido');
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
  updateLoop(); // Primera ejecución inmediata
  updateInterval = setInterval(updateLoop, config.updateInterval);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  Logger.info('\nCerrando...');
  if (updateInterval) clearInterval(updateInterval);
  await discordService.clearActivity();
  discordService.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (updateInterval) clearInterval(updateInterval);
  await discordService.clearActivity();
  discordService.disconnect();
  process.exit(0);
});

// Ejecutar
main().catch((error) => {
  Logger.error('Error fatal', error);
  process.exit(1);
});
