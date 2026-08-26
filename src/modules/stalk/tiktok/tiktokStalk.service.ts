/**
 * TikTok public profile lookup ("stalk"), via headless browser.
 *
 * A plain HTTP fetch to TikTok's profile page from this server gets a WAF
 * challenge page instead of real content (TikTok is known to hard-block
 * datacenter IPs, independent of request volume — unlike Instagram's
 * softer, volume-based rate limiting). Routing through a residential
 * proxy also isn't an option right now (the provider available blocks
 * social-media targets under its own compliance policy).
 *
 * This uses the app's existing shared Chromium pool
 * (src/shared/browser/browserManager.ts, already pre-warmed at startup
 * for the maker/screenshot modules) to load the profile page with a real
 * browser engine instead. Real JS execution + a modern headless Chromium
 * fingerprint (Playwright's "new" headless mode) sometimes clears WAF
 * challenges that a bare `fetch()` can't — but this is not guaranteed;
 * TikTok's bot detection evolves and may still flag headless browsers.
 * If this stops working reliably, the fallback options are: a residential
 * proxy from a provider whose compliance policy allows social media
 * targets, or an official/paid scraping API (e.g. Apify's
 * clockworks/tiktok-profile-scraper).
 *
 * Once the page loads, TikTok's own hydration payload
 * (<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">) is read directly out
 * of the DOM — same data shape a logged-out browser visiting the profile
 * gets, no login required.
 *
 * Successful lookups are cached in-process for 15 min — this method is
 * much more expensive per-call (a real page load) than a plain HTTP
 * request, so avoiding repeat renders matters more here than it did for
 * the Instagram module.
 */

import { withPage } from '@shared/browser/browserManager.js';
import { AppError } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';

const cache = new LruCache<string, TiktokStalkResult>({ max: 500, ttlMs: 15 * 60 * 1000 });

interface TiktokStalkResult {
  username: string;
  nickname: string;
  bio: string;
  avatarUrl: string | null;
  isPrivate: boolean;
  isVerified: boolean;
  followers: number;
  following: number;
  likes: number;
  videos: number;
}

/** Shape of the bits we care about inside __UNIVERSAL_DATA_FOR_REHYDRATION__. */
interface UserDetailScope {
  statusCode?: number;
  userInfo?: {
    user?: {
      uniqueId?: string;
      nickname?: string;
      signature?: string;
      avatarLarger?: string;
      avatarMedium?: string;
      avatarThumb?: string;
      verified?: boolean;
      privateAccount?: boolean;
    };
    stats?: {
      followerCount?: number;
      followingCount?: number;
      heart?: number;
      heartCount?: number;
      videoCount?: number;
    };
    statsV2?: {
      followerCount?: string;
      followingCount?: string;
      heart?: string;
      heartCount?: string;
      videoCount?: string;
    };
  };
}

function toNumber(v: number | string | undefined): number {
  if (v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

async function fetchUserDetail(username: string, signal?: AbortSignal): Promise<UserDetailScope | null> {
  return withPage(
    async (page) => {
      const url = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });

      // The hydration script can take a beat to land (or never lands, if
      // this hit a WAF challenge page instead of the real profile).
      const raw = await page
        .waitForSelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__', { timeout: 8_000 })
        .then((el) => el?.textContent())
        .catch(() => null);

      if (!raw) {
        // Diagnostic-only: capture what actually rendered so logs show
        // WAF-challenge vs genuine 404 vs something else entirely,
        // instead of a single ambiguous "could not read" message.
        const [title, finalUrl, bodySnippet] = await Promise.all([
          page.title().catch(() => '<title read failed>'),
          Promise.resolve(page.url()),
          page
            .evaluate(() => (globalThis as any).document?.body?.innerText?.slice(0, 300) ?? '')
            .catch(() => '<body read failed>'),
        ]);
        // eslint-disable-next-line no-console
        console.warn(
          `[tiktokStalk] hydration script not found for "${username}". title="${title}" finalUrl="${finalUrl}" bodySnippet="${bodySnippet.replace(/\s+/g, ' ').trim()}"`,
        );
        return null;
      }

      try {
        const parsed = JSON.parse(raw);
        return parsed?.__DEFAULT_SCOPE__?.['webapp.user-detail'] ?? null;
      } catch {
        return null;
      }
    },
    {
      signal,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
    },
  );
}

export async function stalkTiktok(username: string, signal?: AbortSignal): Promise<TiktokStalkResult> {
  const cacheKey = username.trim().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let detail: UserDetailScope | null;
  try {
    detail = await fetchUserDetail(username, signal);
  } catch (err) {
    throw new AppError(502, 'TIKTOK_STALK_FAILED', `Headless browser render failed: ${(err as Error).message}`);
  }

  // Ambiguous on purpose: could be a nonexistent user, or a WAF challenge
  // page that never hydrated. Reported as a failure, not asserted as
  // "not found", since headless rendering doesn't always clear the
  // challenge — see module doc comment above.
  if (!detail || (detail.statusCode && detail.statusCode !== 0) || !detail.userInfo?.user?.uniqueId) {
    throw new AppError(
      502,
      'TIKTOK_STALK_FAILED',
      `Could not read TikTok profile "${username}" — either the account doesn't exist, or TikTok served a bot-check page instead of the profile (this happens intermittently even via headless browser).`,
    );
  }

  const user = detail.userInfo.user;
  const stats = detail.userInfo.stats;
  const statsV2 = detail.userInfo.statsV2;

  const result: TiktokStalkResult = {
    username: user.uniqueId!,
    nickname: user.nickname || '',
    bio: user.signature || '',
    avatarUrl: user.avatarLarger || user.avatarMedium || user.avatarThumb || null,
    isPrivate: !!user.privateAccount,
    isVerified: !!user.verified,
    followers: stats?.followerCount ?? toNumber(statsV2?.followerCount),
    following: stats?.followingCount ?? toNumber(statsV2?.followingCount),
    likes: stats?.heart ?? stats?.heartCount ?? toNumber(statsV2?.heart ?? statsV2?.heartCount),
    videos: stats?.videoCount ?? toNumber(statsV2?.videoCount),
  };
  cache.set(cacheKey, result);
  return result;
}