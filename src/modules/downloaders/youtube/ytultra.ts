/**
 * YouTube search via the official Data API v3.
 *
 * NOTE: this file used to also hold the ytultra download client
 * (ytultraGetVideo / ytultraGetAudio). Those were removed on purpose:
 * they returned googlevideo URLs, and googlevideo rejects requests from
 * datacenter IPs, which made `/p/` links return 502 from the panel.
 * Downloads now go through scrapr only (see youtubeAudio.ts and
 * youtube.service.ts). What remains here is just the search function
 * used by ytplay for text queries — it calls googleapis.com, never
 * googlevideo, so the 502 problem does not apply to it.
 */

import axios from 'axios';
import { loadEnv } from '../../../config/env.js';

const YOUTUBE_SEARCH_API = 'https://www.googleapis.com/youtube/v3/search';

export interface YtSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string | null;
}

export async function ytSearch(query: string): Promise<YtSearchResult> {
  const env = loadEnv();
  if (!env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY is not configured');

  const res = await axios.get(YOUTUBE_SEARCH_API, {
    timeout: 10_000,
    params: {
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: 1,
      key: env.YOUTUBE_API_KEY,
    },
  });

  const item = res.data?.items?.[0];
  if (!item) throw new Error('Pencarian YouTube tidak menemukan hasil.');

  const videoId: string = item.id?.videoId;
  const snippet = item.snippet ?? {};

  return {
    videoId,
    title: snippet.title ?? 'YouTube Video',
    channelTitle: snippet.channelTitle ?? '',
    thumbnail:
      snippet.thumbnails?.high?.url ??
      snippet.thumbnails?.medium?.url ??
      snippet.thumbnails?.default?.url ??
      null,
  };
}
