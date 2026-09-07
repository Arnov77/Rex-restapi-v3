/**
 * Instagram public profile lookup ("stalk"), via Apify.
 *
 * Runs the official `apify/instagram-profile-scraper` Actor synchronously
 * and reads its result, instead of calling Instagram directly. This avoids
 * every problem the direct approach had:
 *   - anonymous requests get soft-blocked by IG after ~6 req/min from one IP
 *   - authenticated (cookie) requests get the *account* itself restricted
 *   - datacenter proxies often get rejected by the provider's own compliance
 *     policy before even reaching Instagram (seen with Bright Data)
 * Apify owns all of that infrastructure on their end; this service just
 * calls their API and maps the result.
 *
 * Free Apify plan: $5/month credit, ~$1.60/1,000 profiles → ~3,000 free
 * lookups/month. Requires APIFY_API_TOKEN (console.apify.com → Settings →
 * Integrations).
 *
 * Successful lookups are cached in-process for 15 min (see `cache` below),
 * so repeat searches for the same username shortly after each other don't
 * spend credit again.
 */

import { AppError } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import { loadEnv } from '../../../config/env.js';

const ACTOR_ID = 'apify~instagram-profile-scraper';

// Caches successful lookups only (not "not found"/errors) — repeat searches
// for the same username within the window skip Apify entirely, so they
// don't burn credit. 15 min TTL: long enough to absorb bursts of repeat
// lookups (e.g. several people in the same group checking the same
// account), short enough that follower counts etc. don't go too stale.
const cache = new LruCache<string, InstagramStalkResult>({ max: 500, ttlMs: 15 * 60 * 1000 });

interface InstagramStalkResult {
  username: string;
  fullName: string;
  bio: string;
  externalUrl: string | null;
  profilePicUrl: string | null;
  isPrivate: boolean;
  isVerified: boolean;
  followers: number;
  following: number;
  posts: number;
}

/** Raw shape of one item from apify/instagram-profile-scraper's dataset. */
interface ApifyProfileItem {
  username?: string;
  fullName?: string;
  biography?: string;
  externalUrl?: string | null;
  profilePicUrlHD?: string;
  profilePicUrl?: string;
  private?: boolean;
  verified?: boolean;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  error?: string; // Actor reports per-item errors (e.g. "not found") this way
}

export async function stalkInstagram(username: string, signal?: AbortSignal): Promise<InstagramStalkResult> {
  const cacheKey = username.trim().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const token = loadEnv().APIFY_API_TOKEN;
  if (!token) {
    throw new AppError(500, 'APIFY_NOT_CONFIGURED', 'APIFY_API_TOKEN is not set on the server.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000); // Actor runs take longer than a plain HTTP call
  const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username] }),
      signal: mergedSignal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new AppError(500, 'APIFY_NOT_CONFIGURED', 'Apify rejected the API token (check APIFY_API_TOKEN).');
    }
    if (res.status === 429) {
      throw new AppError(429, 'INSTAGRAM_RATE_LIMITED', 'Apify account is out of credit or hitting its own rate limit, try again shortly.');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AppError(502, 'INSTAGRAM_STALK_FAILED', `Apify run failed with status ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
    }

    const items = (await res.json()) as ApifyProfileItem[];
    const item = items[0];

    if (!item || item.error || !item.username) {
      throw new AppError(404, 'INSTAGRAM_USER_NOT_FOUND', `Instagram user "${username}" not found.`);
    }

    const result: InstagramStalkResult = {
      username: item.username,
      fullName: item.fullName || '',
      bio: item.biography || '',
      externalUrl: item.externalUrl || null,
      profilePicUrl: item.profilePicUrlHD || item.profilePicUrl || null,
      isPrivate: !!item.private,
      isVerified: !!item.verified,
      followers: item.followersCount ?? 0,
      following: item.followsCount ?? 0,
      posts: item.postsCount ?? 0,
    };
    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const cause = (err as { cause?: unknown })?.cause;
    const causeMsg = cause instanceof Error ? `${cause.name}: ${cause.message}` : cause ? String(cause) : undefined;
    throw new AppError(
      502,
      'INSTAGRAM_STALK_FAILED',
      causeMsg ? `${(err as Error).message} (${causeMsg})` : (err as Error).message,
    );
  } finally {
    clearTimeout(timeout);
  }
}