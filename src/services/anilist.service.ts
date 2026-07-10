import axios from 'axios';
import Logger from '../utils/logger';

export interface AnilistAnimeInfo {
  id: number;
  idMal?: number;
  title: {
    romaji: string;
    english?: string;
    native?: string;
  };
  coverImage: {
    large: string;
    color?: string;
  };
  episodes?: number;
  siteUrl: string;
  description?: string;
}

export class AnilistService {
  private cache: Map<string, AnilistAnimeInfo | null> = new Map();
  private enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  /**
   * Busca información de un anime por su título en AniList
   * @param title Título limpio del anime
   * @returns Metadata de AniList o null si no se encuentra o está deshabilitado
   */
  async searchAnime(title: string): Promise<AnilistAnimeInfo | null> {
    if (!this.enabled || !title || title.trim() === '') {
      return null;
    }

    const cacheKey = title.trim().toLowerCase();
    if (this.cache.has(cacheKey)) {
      Logger.debug(`AniList Cache: Retornando info para "${title}"`);
      return this.cache.get(cacheKey) || null;
    }

    Logger.info(`AniList: Buscando metadata para "${title}"...`);

    const query = `
      query ($search: String) {
        Media (search: $search, type: ANIME) {
          id
          idMal
          title {
            romaji
            english
            native
          }
          coverImage {
            large
            color
          }
          episodes
          siteUrl
          description
        }
      }
    `;

    try {
      const response = await axios.post<{ data: { Media: AnilistAnimeInfo | null } }>(
        'https://graphql.anilist.co',
        {
          query,
          variables: { search: title }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 5000
        }
      );

      const media = response.data?.data?.Media || null;
      if (media) {
        Logger.info(`AniList: Anime encontrado: "${media.title.english || media.title.romaji}" (ID: ${media.id})`);
        this.cache.set(cacheKey, media);
        return media;
      } else {
        Logger.info(`AniList: No se encontró anime para "${title}"`);
        this.cache.set(cacheKey, null);
        return null;
      }
    } catch (error) {
      Logger.warn(`AniList: Error al buscar "${title}": ${(error as Error).message}`);
      // No guardar en caché los errores de conexión para poder reintentar luego,
      // pero si es un 404 real, sí cacheamos null.
      const axiosError = error as any;
      if (axiosError.response?.status === 404) {
        this.cache.set(cacheKey, null);
      }
      return null;
    }
  }

  /**
   * Limpia el cache en memoria
   */
  clearCache(): void {
    this.cache.clear();
  }
}
