/**
 * Minimal type declarations for @coflyn/scrapr (the package ships no types).
 * Only the surface this codebase uses is declared.
 */
declare module '@coflyn/scrapr' {
  export interface ScraprDownload {
    url: string;
    type: string;
    quality: string;
  }

  export interface ScraprMediaResult {
    status: boolean;
    message?: string;
    result?: {
      title: string;
      thumbnail: string;
      type: string;
      downloads: ScraprDownload[];
    };
  }

  export interface ScraprYoutube {
    ytmp3: (url: string, format?: string) => Promise<ScraprMediaResult>;
    ytmp3gg: (url: string, options?: { format?: string; quality?: string }) => Promise<ScraprMediaResult>;
    playlist: (url: string) => Promise<unknown>;
  }

  export interface ScraprSpotifyDownload {
    url: string;
    type: string;
    quality: string;
  }

  export interface ScraprSpotifyTrackItem {
    id?: string;
    title?: string;
    name?: string;
    artist?: string;
    artists?: string[];
    album?: string;
    duration?: number;
    duration_ms?: number;
    thumbnail?: string;
    track_url?: string;
    image?: { url?: string };
  }

  export interface ScraprSpotifyResult {
    status: boolean;
    message?: string;
    result?: {
      title?: string;
      artist?: string;
      album?: string;
      thumbnail?: string;
      type?: string;
      trackCount?: number;
      downloads?: ScraprSpotifyDownload[];
      tracks?: ScraprSpotifyTrackItem[];
    };
  }

  export interface ScraprSpotify {
    spotidown: (url: string) => Promise<ScraprSpotifyResult>;
    spotisaver: (url: string) => Promise<ScraprSpotifyResult>;
    spotmate: (url: string) => Promise<ScraprSpotifyResult>;
    soundloaders: (url: string) => Promise<ScraprSpotifyResult>;
  }

  const scrapr: {
    youtube: ScraprYoutube;
    spotify: ScraprSpotify;
  };

  export default scrapr;
}
