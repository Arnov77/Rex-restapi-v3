const { withPage } = require('../../../shared/browser/browserManager');
const capsolver = require('../../../shared/captcha/capsolver');
const logger = require('../../../shared/utils/logger');
const { AppError, ValidationError } = require('../../../shared/utils/errors');

const SPOTIDOWN_URL = 'https://spotidown.co/';
// Sitekey extracted from spotidown.co's Turnstile iframe. Cloudflare sitekeys
// are NOT secret — they live in the page HTML — so it's safe to hard-code.
// Keep this in sync with whatever spotidown.co serves; if they rotate it,
// recon a fresh sitekey from the iframe URL.
const SPOTIDOWN_SITEKEY = '0x4AAAAAACOJphN3ngE6K1Na';

const SPOTIFY_URL_RE =
  /^https?:\/\/(?:open|play)\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show|artist)\/[a-zA-Z0-9]{16,32}/i;

function matches(url) {
  return SPOTIFY_URL_RE.test(url);
}

function classifyUrl(url) {
  const m = url.match(SPOTIFY_URL_RE);
  if (!m) return null;
  return { kind: m[1].toLowerCase() };
}

/**
 * Hit spotidown.co with a freshly-solved Turnstile token, drive the search
 * form, and capture the JSON response their backend ships back. Works for
 * single tracks, playlists, and albums (the same endpoint disambiguates via
 * a `type` field in the response).
 */
async function fetchSpotidown(spotifyUrl, { timeoutMs = 60000 } = {}) {
  if (!capsolver.isConfigured()) {
    throw new AppError(
      'Spotify resolver requires CAPSOLVER_API_KEY (Cloudflare Turnstile bypass).',
      503
    );
  }

  const token = await capsolver.solveTurnstile({
    websiteURL: SPOTIDOWN_URL,
    websiteKey: SPOTIDOWN_SITEKEY,
  });

  return withPage(
    async (page) => {
      // Replace the Cloudflare Turnstile JS API with a stub that immediately
      // resolves with our pre-solved token. The page calls turnstile.render()
      // (or turnstile.execute()) — our stub fires the supplied callback with
      // the token, the page treats the challenge as passed, and proceeds to
      // hit api.spotidown.co.
      await page.addInitScript((tok) => {
        const fire = (opts, t) => {
          try {
            if (opts && typeof opts.callback === 'function') opts.callback(t);
          } catch (_) {
            /* page handler errored — ignore */
          }
        };
        // eslint-disable-next-line no-undef
        window.turnstile = {
          render: (_t, opts) => {
            fire(opts, tok);
            return 'mock-widget-id';
          },
          reset: () => {},
          remove: () => {},
          getResponse: () => tok,
          execute: (_t, opts) => fire(opts, tok),
        };
      }, token);

      let apiPayload = null;
      let apiError = null;

      page.on('response', async (response) => {
        const url = response.url();
        if (!url.startsWith('https://api.spotidown.co/')) return;
        // Skip the audio/file endpoint (savemp3) — only the metadata endpoint
        // returns the JSON we need.
        if (url.includes('/savemp3/')) return;
        try {
          const ct = response.headers()['content-type'] || '';
          if (!ct.includes('application/json')) return;
          const body = await response.json();
          if (body && (body.id || body.tracks || body.error)) {
            apiPayload = body;
          }
        } catch (e) {
          apiError = e;
        }
      });

      await page.goto(SPOTIDOWN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // The form has a single text input + submit button. Try several
      // selectors to be resilient to minor UI changes.
      const inputLocator = page
        .locator('input[type="search"], input[type="text"], input[name="url"]')
        .first();
      await inputLocator.waitFor({ state: 'visible', timeout: 15000 });
      await inputLocator.fill(spotifyUrl);

      // Submit by pressing Enter (more robust across button reskins than a
      // selector match on text/role).
      await inputLocator.press('Enter');

      // Poll for either the API JSON or an error.
      const startedAt = Date.now();
      while (!apiPayload && !apiError && Date.now() - startedAt < timeoutMs) {
        await page.waitForTimeout(400);
      }
      if (apiError)
        throw new AppError(`spotidown.co response parse failed: ${apiError.message}`, 502);
      if (!apiPayload) throw new AppError('spotidown.co timed out (no JSON received)', 504);
      return apiPayload;
    },
    {
      // A real-looking UA to dodge naive UA filtering.
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  );
}

function normalizeTrack(t, fallbackSourceUrl) {
  if (!t) return null;
  // spotidown ships duration in milliseconds.
  const durMs = typeof t.duration === 'number' ? t.duration : null;
  return {
    id: t.id || null,
    title: t.name || t.title || null,
    artists: Array.isArray(t.artists) ? t.artists : t.artist ? [t.artist] : [],
    album: t.album?.name || null,
    releaseDate: t.album?.releaseDate || null,
    cover: t.album?.coverUrl || t.thumb || null,
    durationMs: durMs,
    durationSec: durMs ? Math.round(durMs / 1000) : null,
    sourceUrl: fallbackSourceUrl || (t.id ? `https://open.spotify.com/track/${t.id}` : null),
    audio: t.audio?.url
      ? {
          url: t.audio.url,
          sizeBytes: t.audio.size || null,
          format: 'mp3',
        }
      : null,
  };
}

/**
 * Resolve a Spotify URL (track / playlist / album) to a normalized payload.
 * Returns:
 *   { type: 'track', source: 'spotidown', track: {...}  }
 *   { type: 'playlist'|'album', source: 'spotidown', name, totalCount, tracks: [...] }
 */
async function resolve(url) {
  const cls = classifyUrl(url);
  if (!cls) throw new ValidationError(`Not a recognised Spotify URL: ${url}`);
  if (!['track', 'album', 'playlist'].includes(cls.kind)) {
    throw new ValidationError(
      `Spotify ${cls.kind} URLs are not supported — only track/album/playlist.`
    );
  }

  logger.info(`[music:spotify] resolving via spotidown.co (${cls.kind})`);
  const raw = await fetchSpotidown(url);

  if (raw.error) throw new AppError(`spotidown.co: ${raw.error}`, 502);

  const type = (raw.type || cls.kind).toLowerCase();

  if (type === 'track' || (raw.id && !raw.tracks)) {
    const track = normalizeTrack(raw, url);
    return {
      type: 'track',
      source: 'spotidown',
      track,
    };
  }

  // Playlist or album response shape.
  const tracks = (raw.tracks || []).map((t) => normalizeTrack(t)).filter(Boolean);
  return {
    type: type === 'album' ? 'album' : 'playlist',
    source: 'spotidown',
    id: raw.id || null,
    name: raw.name || null,
    cover: raw.coverUrl || raw.thumb || null,
    totalCount: typeof raw.totalCount === 'number' ? raw.totalCount : tracks.length,
    tracks,
  };
}

module.exports = {
  matches,
  resolve,
  // Exported for tests.
  _classifyUrl: classifyUrl,
  _normalizeTrack: normalizeTrack,
};
