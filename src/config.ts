import * as dotenv from 'dotenv';
import { Config } from './types';

dotenv.config();

function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (!value && defaultValue === undefined) {
    throw new Error(`Variable de entorno ${name} no está definida`);
  }
  return value || defaultValue || '';
}

function getEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function getEnvBooleanOrAuto(name: string, defaultValue: boolean | 'auto'): boolean | 'auto' {
  const value = process.env[name];
  if (!value) return defaultValue;
  if (value.toLowerCase() === 'auto') return 'auto';
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadConfig(): Config {
  return {
    mpc: {
      host: getEnvVar('MPC_HOST', 'localhost'),
      port: getEnvNumber('MPC_PORT', 13579)
    },
    imgur: {
      clientId: getEnvVar('IMGUR_CLIENT_ID'),
      uploadInterval: getEnvNumber('IMGUR_UPLOAD_INTERVAL', 120000) // 2 min default
    },
    discord: {
      clientId: getEnvVar('DISCORD_CLIENT_ID'),
      autoRestart: getEnvBoolean('AUTO_RESTART_DISCORD', false),
      restartThreshold: getEnvNumber('DISCORD_RESTART_THRESHOLD', 60) // Reiniciar después de 60 imágenes únicas
    },
    updateInterval: getEnvNumber('UPDATE_INTERVAL', 15000),
    flipThumbnail: getEnvBoolean('FLIP_THUMBNAIL', false), // Fix para imagen espejada
    flipVertical: getEnvBooleanOrAuto('FLIP_VERTICAL', false) // false default, 'auto' detecta monitores, true forzado
  };
}
