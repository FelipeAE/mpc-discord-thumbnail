import * as crypto from 'crypto';
import { exec } from 'child_process';

/**
 * Detecta la cantidad de monitores activos (Windows)
 * Usa System.Windows.Forms.Screen que detecta monitores en uso, no físicos
 * @returns Promesa con el número de monitores activos
 */
export async function getActiveMonitorCount(): Promise<number> {
  return new Promise((resolve) => {
    const cmd = 'powershell -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens.Count"';
    exec(cmd, { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(1); // Default a 1 si falla
        return;
      }
      const count = parseInt(stdout.trim(), 10);
      resolve(isNaN(count) ? 1 : count);
    });
  });
}

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
 * Ejemplo: "[Erai-raws] Chitose-kun wa Ramune Bin no Naka - 08 [1080p CR WEB-DL AVC AAC][MultiSub][0B350900].mkv"
 * Resultado: "Chitose-kun wa Ramune Bin no Naka - 08"
 */
export function cleanFilename(filename: string): string {
  // Remover extensión
  let cleaned = filename.replace(/\.[^/.]+$/, '');

  // Remover grupo/fansub al inicio: [Erai-raws], [SubsPlease], etc.
  cleaned = cleaned.replace(/^\[[^\]]+\]\s*/, '');

  // Remover tags técnicos al final: [1080p...], [MultiSub], [hash], (1080p), etc.
  // Repetir hasta que no haya más tags
  let previous = '';
  while (previous !== cleaned) {
    previous = cleaned;
    cleaned = cleaned.replace(/\s*[\[\(][^\[\]()]*[\]\)]\s*$/, '');
  }

  // Limpiar espacios extra
  cleaned = cleaned.trim();

  // Limitar longitud para Discord (128 chars max para details)
  return cleaned.length > 100 ? cleaned.substring(0, 97) + '...' : cleaned;
}
