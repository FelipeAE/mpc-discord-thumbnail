export interface MpcStatus {
  file: string;
  filepath: string;
  state: 'stopped' | 'paused' | 'playing';
  stateCode: number;
  position: number;      // milliseconds
  duration: number;      // milliseconds
  positionString: string;
  durationString: string;
}

export interface Config {
  mpc: {
    host: string;
    port: number;
  };
  imgur: {
    clientId: string;
    uploadInterval: number;
  };
  discord: {
    clientId: string;
    autoRestart: boolean;
    restartThreshold: number; // Cantidad de imágenes únicas antes de reiniciar Discord
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
