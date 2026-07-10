export enum UploadReason {
  FILE_CHANGE = 'cambio de archivo',
  RESUME = 'resume después de pausa',
  PAUSED_REFRESH = 'refresh durante pausa'
}

export interface PlayerStatus {
  file: string;
  filepath: string;
  state: 'stopped' | 'paused' | 'playing';
  stateCode: number;
  position: number;      // milliseconds
  duration: number;      // milliseconds
  positionString: string;
  durationString: string;
}

export type MpcStatus = PlayerStatus;

export interface PlayerService {
  name: string;
  getStatus(): Promise<PlayerStatus | null>;
  getSnapshot(): Promise<Buffer | null>;
  isConnected(): Promise<boolean>;
}

export interface Config {
  mpc: {
    host: string;
    port: number;
  };
  vlc: {
    host: string;
    port: number;
    password?: string;
  };
  imgur: {
    clientId: string;
    uploadInterval: number;
    provider: 'imgur' | 'catbox' | 'imgbb';
    imgbbApiKey?: string;
  };
  discord: {
    clientId: string;
    autoRestart: boolean;
    restartThreshold: number; // Cantidad de imágenes únicas antes de reiniciar Discord
    buttons?: Array<{ label: string; url: string }>;
  };
  image: {
    maxWidth: number;
    quality: number;
  };
  anilist: {
    enabled: boolean;
  };
  updateInterval: number;
  flipThumbnail: boolean; // Fix para bug de MPC-HC con múltiples monitores (horizontal)
  flipVertical: boolean | 'auto'; // 'auto' detecta monitores, true/false forzado
}

export interface ImgurUploadResponse {
  data: {
    id: string;
    link: string;
    deletehash: string;
    type?: string;
    size?: number;
    width?: number;
    height?: number;
  };
  success: boolean;
  status: number;
}

