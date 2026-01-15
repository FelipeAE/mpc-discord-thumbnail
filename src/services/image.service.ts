import sharp from 'sharp';
import Logger from '../utils/logger';

export class ImageService {
  private width: number;
  private quality: number;
  private flipHorizontal: boolean;
  private flipVertical: boolean | 'auto';

  /**
   * @param width - Ancho máximo de la imagen (default: 640px)
   * @param quality - Calidad JPEG 1-100 (default: 80)
   * @param flipHorizontal - Voltear imagen horizontalmente (default: false) - útil para bug de MPC-HC con múltiples monitores
   * @param flipVertical - Voltear imagen verticalmente (default: false, 'auto' para detectar monitores)
   */
  constructor(width: number = 640, quality: number = 80, flipHorizontal: boolean = false, flipVertical: boolean | 'auto' = false) {
    this.width = width;
    this.quality = quality;
    this.flipHorizontal = flipHorizontal;
    this.flipVertical = flipVertical;
  }

  /**
   * Actualiza el estado de flip vertical (para modo auto)
   */
  setFlipVertical(flip: boolean): void {
    if (this.flipVertical === 'auto') {
      this.currentFlipVertical = flip;
    }
  }

  private currentFlipVertical: boolean = false;

  /**
   * Comprime y redimensiona una imagen
   * @param imageBuffer - Buffer de la imagen original
   * @returns Buffer de la imagen comprimida
   */
  async compress(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const originalSize = imageBuffer.length;

      let pipeline = sharp(imageBuffer)
        .resize(this.width, null, {
          withoutEnlargement: true,
          fit: 'inside'
        });
      
      // Fix para bug de MPC-HC con múltiples monitores que causa imagen espejada
      if (this.flipHorizontal) {
        pipeline = pipeline.flop();
      }
      
      // Fix para renderizador MPC que produce imagen de cabeza
      const shouldFlipVertical = this.flipVertical === 'auto' ? this.currentFlipVertical : this.flipVertical;
      if (shouldFlipVertical) {
        pipeline = pipeline.flip();
      }

      const compressed = await pipeline
        .jpeg({
          quality: this.quality,
          mozjpeg: true
        })
        .toBuffer();

      const newSize = compressed.length;
      const reduction = Math.round((1 - newSize / originalSize) * 100);

      Logger.debug(`Imagen comprimida: ${this.formatSize(originalSize)} -> ${this.formatSize(newSize)} (-${reduction}%)`);

      return compressed;
    } catch (error) {
      Logger.error('Error al comprimir imagen', error as Error);
      // Si falla la compresión, devolver la original
      return imageBuffer;
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }
}
