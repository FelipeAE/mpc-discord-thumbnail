import * as dotenv from 'dotenv';
import { Config } from './types';

dotenv.config();

function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name]?.trim();
  if (!value && defaultValue === undefined) {
    throw new Error(`Variable de entorno ${name} no está definida`);
  }
  return value || defaultValue || '';
}

function getEnvNumber(name: string, defaultValue: number, min?: number, max?: number): number {
  const value = process.env[name]?.trim();
  if (!value) return defaultValue;

  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Variable ${name} debe ser un número entero válido`);
  }

  const parsed = parseInt(value, 10);
  if (min !== undefined && parsed < min) {
    throw new Error(`Variable ${name} debe ser mayor o igual a ${min}`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`Variable ${name} debe ser menor o igual a ${max}`);
  }
  return parsed;
}

function getEnvBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`Variable ${name} debe ser true/false o 1/0`);
}

function getEnvBooleanOrAuto(name: string, defaultValue: boolean | 'auto'): boolean | 'auto' {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  if (value === 'auto') return 'auto';
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`Variable ${name} debe ser auto/true/false o 1/0`);
}

function isLocalHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase();
  return normalizedHost === 'localhost' || normalizedHost === '127.0.0.1' || normalizedHost === '::1';
}

function validateClientId(name: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 6) {
    throw new Error(`Variable ${name} parece inválida (muy corta)`);
  }
  return trimmed;
}

export function loadConfig(): Config {
  const mpcHost = getEnvVar('MPC_HOST', 'localhost').toLowerCase();
  const allowRemoteMpc = getEnvBoolean('ALLOW_REMOTE_MPC', false);
  if (!allowRemoteMpc && !isLocalHost(mpcHost)) {
    throw new Error(
      `MPC_HOST=${mpcHost} no es seguro por defecto. Usa localhost/127.0.0.1 o habilita ALLOW_REMOTE_MPC=true explícitamente`
    );
  }

  return {
    mpc: {
      host: mpcHost,
      port: getEnvNumber('MPC_PORT', 13579, 1, 65535)
    },
    imgur: {
      clientId: validateClientId('IMGUR_CLIENT_ID', getEnvVar('IMGUR_CLIENT_ID')),
      uploadInterval: getEnvNumber('IMGUR_UPLOAD_INTERVAL', 60000, 10000, 3600000) // 10s a 60 min
    },
    discord: {
      clientId: validateClientId('DISCORD_CLIENT_ID', getEnvVar('DISCORD_CLIENT_ID')),
      autoRestart: getEnvBoolean('AUTO_RESTART_DISCORD', false),
      restartThreshold: getEnvNumber('DISCORD_RESTART_THRESHOLD', 60, 1, 10000) // Reiniciar después de X imágenes únicas
    },
    updateInterval: getEnvNumber('UPDATE_INTERVAL', 15000, 5000, 300000),
    flipThumbnail: getEnvBoolean('FLIP_THUMBNAIL', false), // Fix para imagen espejada
    flipVertical: getEnvBooleanOrAuto('FLIP_VERTICAL', false) // false default, 'auto' detecta monitores, true forzado
  };
}
