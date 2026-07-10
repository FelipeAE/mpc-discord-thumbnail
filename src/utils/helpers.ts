import * as crypto from 'crypto';
import { execFile } from 'child_process';

/**
 * Detecta la cantidad de monitores activos (Windows)
 * Usa System.Windows.Forms.Screen que detecta monitores en uso, no físicos
 * @returns Promesa con el número de monitores activos
 */
export async function getActiveMonitorCount(): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens.Count'
      ],
      { timeout: 5000, windowsHide: true },
      (error, stdout) => {
      if (error) {
        resolve(1); // Default a 1 si falla
        return;
      }
      const count = parseInt(stdout.trim(), 10);
      resolve(isNaN(count) ? 1 : count);
      }
    );
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
 * 
 * Ejemplo scene: "The.Darwin.Incident.S01E12.Sexual.Dimorphism.1080p.AMDL.DUAL.DDP2.0.H.265.MSubs-ToonsHub.mkv"
 * Resultado: "The Darwin Incident - S01E12 - Sexual Dimorphism"
 */
export function cleanFilename(filename: string): string {
  // Remover extensión
  let cleaned = filename.replace(/\.[^/.]+$/, '');

  // Remover grupo/fansub al inicio: [Erai-raws], [SubsPlease], etc.
  cleaned = cleaned.replace(/^\[[^\]]+\]\s*/, '');

  // Detectar formato scene (puntos como separadores con patrón SxxExx)
  // Soporta: Show.Name.S01E05.Title.1080p.WEB.mkv, Show.Name.2024.S01E05.PROPER.mkv, etc.
  const sceneMatch = cleaned.match(/^(.+?)\.(S\d{2}E\d{2})\.(.+?)\.(\d{3,4}p|WEB[-.]?DL|WEB[-.]?Rip|WEBRip|HDTV|BluRay|BDRip|AMZN|NF|DSNP|ATVP|HMAX|PROPER|REPACK|INTERNAL|DDP?\d|AAC|H\.?26[45]|x26[45]|HEVC|AVC|10bit)/i);
  if (sceneMatch) {
    let showName = sceneMatch[1].replace(/\./g, ' ');
    // Remover año trailing del nombre del show si existe (ej: "Show Name 2024")
    showName = showName.replace(/\s+\d{4}$/, '');
    const episode = sceneMatch[2].toUpperCase();
    const episodeTitle = sceneMatch[3].replace(/\./g, ' ');
    cleaned = `${showName} - ${episode} - ${episodeTitle}`;
  } else {
    // Remover tags técnicos al final: [1080p...], [MultiSub], [hash], (1080p), etc.
    // Repetir hasta que no haya más tags
    let previous = '';
    while (previous !== cleaned) {
      previous = cleaned;
      cleaned = cleaned.replace(/\s*[\[\(][^\[\]()]*[\]\)]\s*$/, '');
    }
  }

  // Limpiar espacios extra
  cleaned = cleaned.trim();

  // Limitar longitud para Discord (128 chars max para details)
  return cleaned.length > 100 ? cleaned.substring(0, 97) + '...' : cleaned;
}

/**
 * Parsea el nombre del archivo para extraer el título de la serie y el número de episodio.
 * Útil para consultar APIs de metadata (como AniList).
 */
export function parseAnimeFilename(filename: string): { title: string; episode?: number } | null {
  // Remover extensión
  let cleaned = filename.replace(/\.[^/.]+$/, '');

  // Remover grupo/fansub al inicio: [Erai-raws], [SubsPlease], etc.
  cleaned = cleaned.replace(/^\[[^\]]+\]\s*/, '');

  // Caso 1: Formato scene (puntos como separadores con patrón SxxExx)
  const sceneMatch = cleaned.match(/^(.+?)\.(S\d{2}E\d{2})\.(.+?)\.(\d{3,4}p|WEB[-.]?DL|WEB[-.]?Rip|WEBRip|HDTV|BluRay|BDRip|AMZN|NF|DSNP|ATVP|HMAX|PROPER|REPACK|INTERNAL|DDP?\d|AAC|H\.?26[45]|x26[45]|HEVC|AVC|10bit)/i);
  if (sceneMatch) {
    let showName = sceneMatch[1].replace(/\./g, ' ');
    showName = showName.replace(/\s+\d{4}$/, '').trim();
    const episodeString = sceneMatch[2].match(/E(\d+)/i)?.[1];
    const episode = episodeString ? parseInt(episodeString, 10) : undefined;
    return { title: showName, episode };
  }

  // Caso 2: Formato tradicional (removiendo tags técnicos al final)
  let previous = '';
  while (previous !== cleaned) {
    previous = cleaned;
    cleaned = cleaned.replace(/\s*[\[\(][^\[\]()]*[\]\)]\s*$/, '');
  }

  // Patrones comunes para buscar el número de episodio
  const episodePatterns = [
    /\s+-\s+Episode\s+(\d+)\s*$/i,
    /\s+-\s+(\d+)\s*$/,
    /\s+Episode\s+(\d+)\s*$/i,
    /\s+Ep\s+(\d+)\s*$/i,
    /\s+(\d+)\s*$/
  ];

  for (const pattern of episodePatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const episode = parseInt(match[1], 10);
      let title = cleaned.replace(pattern, '').trim();
      title = title.replace(/\s*-\s*$/, '').trim(); // Eliminar guión trailing si existe
      if (title.length > 0) {
        return { title, episode };
      }
    }
  }

  const trimmed = cleaned.trim();
  return trimmed.length > 0 ? { title: trimmed } : null;
}

