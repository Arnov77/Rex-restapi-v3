/**
 * TikTok public profile lookup ("stalk"), via Apify.
 *
 * Runs `clockworks/free-tiktok-scraper` ("TikTok Data Extractor")
 * synchronously and reads `authorMeta` off the first returned video item.
 *
 * Why this instead of scraping directly: a plain HTTP fetch to TikTok's
 * profile page from this server gets a WAF challenge page (TikTok hard-blocks
 * datacenter IPs, independent of request volume). A headless-browser attempt
 * got further — the real page rendered — but TikTok served a slider CAPTCHA
 * on top and dropped the `__UNIVERSAL_DATA_FOR_REHYDRATION__` hydration
 * script that earlier parsing relied on, making it unreliable turn to turn.
 * Apify owns the infrastructure to deal with this consistently; this
 * service just calls their API and maps the result.
 *
 * Same shape/limitation as the profile-scraper Actor this replaced: data
 * comes from `authorMeta` on a *video* item, so an account with zero public
 * videos won't return anything even if it exists and is public.
 *
 * Pricing: pay-per-result on Apify's usual result-based pricing (same
 * $5/month free credit pool as the Instagram stalk module — check
 * console.apify.com for current per-1,000-result pricing on this Actor).
 * Requires APIFY_API_TOKEN (same token already used for Instagram).
 *
 * Successful lookups are cached in-process for 15 min, same policy as the
 * Instagram module, so repeat searches don't spend credit again.
 */

import { AppError } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import { loadEnv } from '../../../config/env.js';

const ACTOR_ID = 'clockworks~free-tiktok-scraper';

const cache = new LruCache<string, TiktokStalkResult>({ max: 500, ttlMs: 15 * 60 * 1000 });

interface TiktokStalkResult {
  id: string;
  username: string;
  nickname: string;
  bio: string;
  bioLink: string | null;
  profileUrl: string;
  avatarUrl: string | null;
  originalAvatarUrl: string | null;
  isPrivate: boolean;
  isVerified: boolean;
  isCommerceUser: boolean;
  isTtSeller: boolean;
  followers: number;
  following: number;
  friends: number;
  likes: number;
  videos: number;
  digg: number;
  roomId: string | null;
  accountCreateTime: number | null;
  accountCreateTimeISO: string | null;
}

/** authorMeta shape observed on clockworks/free-tiktok-scraper's video items. */
interface ApifyAuthorMeta {
  id?: string;
  name?: string;
  profileUrl?: string;
  nickName?: string;
  verified?: boolean;
  signature?: string;
  bioLink?: string | null;
  avatar?: string;
  originalAvatarUrl?: string;
  commerceUserInfo?: { commerceUser?: boolean };
  privateAccount?: boolean;
  roomId?: string;
  ttSeller?: boolean;
  createTime?: number;
  following?: number;
  friends?: number;
  fans?: number;
  heart?: number;
  video?: number;
  digg?: number;
}

interface ApifyTiktokItem {
  authorMeta?: ApifyAuthorMeta;
  errorCode?: string;
  error?: string;
}

const ERROR_MESSAGES: Record<string, { status: number; code: string; message: (u: string) => string }> = {
  NOT_FOUND: { status: 404, code: 'TIKTOK_USER_NOT_FOUND', message: (u) => `TikTok user "${u}" not found.` },
  PROFILE_PRIVATE: {
    status: 403,
    code: 'TIKTOK_PROFILE_PRIVATE',
    message: (u) => `TikTok user "${u}" is private — no public data available.`,
  },
  PROFILE_EMPTY: {
    status: 404,
    code: 'TIKTOK_PROFILE_EMPTY',
    message: (u) => `TikTok user "${u}" exists but has no public videos, so no profile stats could be read.`,
  },
};

export async function stalkTiktok(username: string, signal?: AbortSignal): Promise<TiktokStalkResult> {
  const cacheKey = username.trim().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const token = loadEnv().APIFY_API_TOKEN;
  if (!token) {
    throw new AppError(500, 'APIFY_NOT_CONFIGURED', 'APIFY_API_TOKEN is not set on the server.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profiles: [username],
        resultsPerPage: 1, // only need one video item to read authorMeta from
        profileScrapeSections: ['videos'],
        profileSorting: 'latest',
        shouldDownloadCovers: false,
        shouldDownloadSlideshowImages: false,
        shouldDownloadSubtitles: false,
        shouldDownloadVideos: false,
      }),
      signal: mergedSignal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new AppError(500, 'APIFY_NOT_CONFIGURED', 'Apify rejected the API token (check APIFY_API_TOKEN).');
    }
    if (res.status === 429) {
      throw new AppError(429, 'TIKTOK_RATE_LIMITED', 'Apify account is out of credit or hitting its own rate limit, try again shortly.');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AppError(502, 'TIKTOK_STALK_FAILED', `Apify run failed with status ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
    }

    const items = (await res.json()) as ApifyTiktokItem[];
    const item = items[0];

    if (!item) {
      throw new AppError(404, 'TIKTOK_USER_NOT_FOUND', `TikTok user "${username}" not found.`);
    }

    if (item.errorCode) {
      const known = ERROR_MESSAGES[item.errorCode];
      if (known) throw new AppError(known.status, known.code, known.message(username));
      throw new AppError(502, 'TIKTOK_STALK_FAILED', item.error || `TikTok lookup failed (${item.errorCode})`);
    }

    const meta = item.authorMeta;
    if (!meta || !meta.name) {
      throw new AppError(404, 'TIKTOK_USER_NOT_FOUND', `TikTok user "${username}" not found.`);
    }

    const result: TiktokStalkResult = {
      id: meta.id || '',
      username: meta.name,
      nickname: meta.nickName || '',
      bio: meta.signature || '',
      bioLink: meta.bioLink || null,
      profileUrl: meta.profileUrl || `https://www.tiktok.com/@${meta.name}`,
      avatarUrl: meta.avatar || null,
      originalAvatarUrl: meta.originalAvatarUrl || meta.avatar || null,
      isPrivate: !!meta.privateAccount,
      isVerified: !!meta.verified,
      isCommerceUser: !!meta.commerceUserInfo?.commerceUser,
      isTtSeller: !!meta.ttSeller,
      followers: meta.fans ?? 0,
      following: meta.following ?? 0,
      friends: meta.friends ?? 0,
      likes: meta.heart ?? 0,
      videos: meta.video ?? 0,
      digg: meta.digg ?? 0,
      roomId: meta.roomId || null,
      accountCreateTime: meta.createTime ?? null,
      accountCreateTimeISO: meta.createTime ? new Date(meta.createTime * 1000).toISOString() : null,
    };
    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const cause = (err as { cause?: unknown })?.cause;
    const causeMsg = cause instanceof Error ? `${cause.name}: ${cause.message}` : cause ? String(cause) : undefined;
    throw new AppError(
      502,
      'TIKTOK_STALK_FAILED',
      causeMsg ? `${(err as Error).message} (${causeMsg})` : (err as Error).message,
    );
  } finally {
    clearTimeout(timeout);
  }
}