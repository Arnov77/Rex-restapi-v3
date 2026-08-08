import { loadEnv } from '../../../config/env.js';
import { AppError } from '@shared/errors.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';

export interface NsfwResult {
  is_nsfw: boolean;
  score: number;

  rating: 'safe' | 'suggestive' | 'explicit';

  categories: string[];

  severity?: 'low' | 'medium' | 'high';

  top_category?: {
    name: string;
    score: number;
  };

  details?: {
    explicit: number;
    suggestive: number;
    safe: number;
  };
}

function getCredentials(): { apiUser: string; apiSecret: string } {
  const env = loadEnv();
  const apiUser = env.SIGHTENGINE_API_USER;
  const apiSecret = env.SIGHTENGINE_API_SECRET;
  if (!apiUser || !apiSecret) {
    throw new AppError(503, 'NSFW_NOT_CONFIGURED', 'SIGHTENGINE_API_USER/SECRET not set', null, 'NSFW detection is not configured on this server.');
  }
  return { apiUser, apiSecret };
}

// ─── Parse Response ───────────────────────────────────────────────────────────

interface SightEngineResponse {
  status: string;

  nudity?: {
    sexual_activity?: number;
    sexual_display?: number;
    erotica?: number;

    very_suggestive?: number;
    suggestive?: number;
    mildly_suggestive?: number;

    none?: number;

    suggestive_classes?: Record<string, number>;
  };

  error?: {
    message: string;
  };
}

function parseResult(data: SightEngineResponse): NsfwResult {
  if (data.status !== 'success') {
    throw new AppError(
      502,
      'NSFW_API_ERROR',
      data.error?.message ?? 'SightEngine error',
      null,
      'Could not analyze this image.'
    );
  }

  const n = data.nudity ?? {};

  const explicitScore = Math.max(
    n.sexual_activity ?? 0,
    n.sexual_display ?? 0,
    n.erotica ?? 0
  );

  const suggestiveScore = Math.max(
    n.mildly_suggestive ?? 0,
    n.suggestive ?? 0,
    n.very_suggestive ?? 0
  );

  const safeScore = n.none ?? 0;

  const topSuggestive =
    Object.entries(n.suggestive_classes ?? {})
      .sort((a, b) => b[1] - a[1])[0];

  const categories: string[] = [];

  if (explicitScore >= 0.5) {
    categories.push('explicit');
  }

  if (suggestiveScore >= 0.5) {
    categories.push('suggestive');
  }

  let rating: 'safe' | 'suggestive' | 'explicit';
  let severity: 'low' | 'medium' | 'high' | undefined;
  let score: number;
  let is_nsfw: boolean;

  if (explicitScore >= 0.5) {
    rating = 'explicit';
    is_nsfw = true;
    score = explicitScore;
  } else if (suggestiveScore >= 0.5) {
    rating = 'suggestive';
    is_nsfw = true;
    score = suggestiveScore;

    if (suggestiveScore >= 0.9) {
      severity = 'high';
    } else if (suggestiveScore >= 0.7) {
      severity = 'medium';
    } else {
      severity = 'low';
    }
  } else {
    rating = 'safe';
    is_nsfw = false;
    score = Math.max(explicitScore, suggestiveScore);
  }

  return {
    is_nsfw,
    score,
    rating,
    categories,
    severity,
    top_category: topSuggestive
      ? {
          name: topSuggestive[0],
          score: topSuggestive[1],
        }
      : undefined,

    details: {
      explicit: explicitScore,
      suggestive: suggestiveScore,
      safe: safeScore,
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

const SE_ENDPOINT = 'https://api.sightengine.com/1.0/check.json';
const MODELS = 'nudity-2.1';

export async function detectNsfwFromUrl(imageUrl: string): Promise<NsfwResult> {
  await assertPublicUrl(imageUrl);
  const { apiUser, apiSecret } = getCredentials();

  const params = new URLSearchParams({
    url: imageUrl,
    models: MODELS,
    api_user: apiUser,
    api_secret: apiSecret,
  });

  const res = await fetch(`${SE_ENDPOINT}?${params}`);
  const data = await res.json() as SightEngineResponse;
  return parseResult(data);
}

export async function detectNsfwFromBuffer(buffer: Buffer, mimeType: string): Promise<NsfwResult> {
  if (!buffer.length) throw new AppError(400, 'NSFW_EMPTY_FILE', 'Empty file', null, 'The uploaded file is empty.');
  if (buffer.length > 50 * 1024 * 1024) throw new AppError(413, 'NSFW_FILE_TOO_LARGE', 'File > 50MB', null, 'Ukuran file terlalu besar, maksimal 50 MB.');

  const { apiUser, apiSecret } = getCredentials();

  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mimeType }), 'file');
  form.append('models', MODELS);
  form.append('api_user', apiUser);
  form.append('api_secret', apiSecret);

  const res = await fetch(SE_ENDPOINT, { method: 'POST', body: form });
  const data = await res.json() as SightEngineResponse;
  return parseResult(data);
}