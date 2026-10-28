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

  const scrapr: {
    youtube: ScraprYoutube;
  };

  export default scrapr;
}
