import sharp from 'sharp';
import Logger from '../utils/logger';

export class ImageService {
  private width: number;
  private quality: number;

  /**
   * @param width - Ancho máximo de la imagen (default: 640px)
   * @param quality - Calidad JPEG 1-100 (default: 80)
   */
  constructor(width: number = 640, quality: number = 80) {
    this.width = width;
    this.quality = quality;
  }

  /**
   * Comprime y redimensiona una imagen
   * @param imageBuffer - Buffer de la imagen original
   * @returns Buffer de la imagen comprimida
   */
  async compress(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const originalSize = imageBuffer.length;

      const compressed = await sharp(imageBuffer)
        .resize(this.width, null, {
          withoutEnlargement: true,
          fit: 'inside'
        })
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
