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
  };
  updateInterval: number;
}

export interface ImgurUploadResponse {
  data: {
    id: string;
    link: string;
    deletehash: string;
  };
  success: boolean;
  status: number;
}
