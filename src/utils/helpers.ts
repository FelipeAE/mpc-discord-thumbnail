import * as crypto from 'crypto';

/**
 * Formatea milisegundos a formato HH:MM:SS o MM:SS
 */
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Parsea el HTML de variables de MPC-HC y extrae los valores
 */
export function parseMpcVariables(html: string): Record<string, string> {
  const variables: Record<string, string> = {};
  // MPC-HC devuelve variables en formato: <p id="variable">valor</p>
  const regex = /<p id="(\w+)">([^<]*)<\/p>/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    variables[match[1]] = match[2];
  }

  return variables;
}

/**
 * Calcula el hash MD5 de un buffer
 */
export function calculateHash(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Limpia el nombre del archivo para mostrarlo
 */
export function cleanFilename(filename: string): string {
  // Remover extensión
  const withoutExt = filename.replace(/\.[^/.]+$/, '');
  // Reemplazar puntos y guiones bajos por espacios
  const cleaned = withoutExt.replace(/[._]/g, ' ');
  // Limitar longitud
  return cleaned.length > 50 ? cleaned.substring(0, 47) + '...' : cleaned;
}
