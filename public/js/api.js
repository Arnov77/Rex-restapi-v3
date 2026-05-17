/**
 * Thin fetch wrapper with consistent error shape and auth injection.
 *
 * Why a wrapper instead of fetch() inline:
 *   1. Auth header logic lives in ONE place. Endpoints declare which scheme
 *      they need (apiKey vs bearerAuth) via the OpenAPI security clause;
 *      callers don't have to remember which to send.
 *   2. We always parse the body even on errors so the UI can surface the
 *      `error.message` field from our envelope (`{ ok:false, error:{...} }`)
 *      rather than just "HTTP 400".
 *   3. We capture x-request-id & RateLimit-* headers into the result so the
 *      result pane can render them without re-reading the response object.
 *
 * The wrapper deliberately does NOT throw on non-2xx — for the playground
 * we want to display 4xx/5xx responses to the user, not blow up the modal.
 */

const ENVELOPE_PREVIEW_BYTES = 256 * 1024; // 256 KB cap on text body capture

export class ApiClient {
  /**
   * @param {() => { jwt?: string|null, apiKey?: string|null }} getAuth
   *        Lazy auth getter — re-read on every call so logout/login takes
   *        effect immediately without needing a re-instantiated client.
   */
  constructor(getAuth) {
    this.getAuth = getAuth ?? (() => ({}));
  }

  /**
   * Build headers for a request based on the endpoint's `security` array
   * from the OpenAPI spec. Falls back to no auth if security is empty/null.
   *
   * Behaviour:
   *   1. When `security` is declared, satisfy it explicitly (bearer JWT
   *      on Authorization, or `X-API-Key` on the named header).
   *   2. When `security` is empty (e.g. /api/screenshot, /api/brat, /api/quote
   *      are auth-optional), opportunistically attach the cached API key
   *      so a logged-in user's dashboard hits get counted against their
   *      per-key daily quota. Without this, the backend's quota plugin
   *      buckets the request under `ip:<req.ip>`, and /api/me/usage
   *      (which reads `key:<apiKeyId>`) is forever stuck at 0 USED no
   *      matter how many endpoints the user tests from the playground.
   *
   * `securitySchemes` comes from the OpenAPI doc; we look up each entry
   * by name to know whether it's apiKey-in-header or bearer-jwt.
   */
  buildAuthHeaders(security, securitySchemes) {
    const headers = {};
    const auth = this.getAuth();

    // 1. Satisfy declared security first. OpenAPI `security` is an OR-list
    //    of AND-objects; we only support the simple case (one scheme per
    //    requirement) which matches everything the backend defines today.
    if (security && security.length > 0) {
      for (const requirement of security) {
        for (const schemeName of Object.keys(requirement)) {
          const scheme = securitySchemes?.[schemeName];
          if (!scheme) continue;
          if (scheme.type === 'apiKey' && scheme.in === 'header') {
            if (auth.apiKey) {
              headers[scheme.name] = auth.apiKey;
              return headers; // first matching scheme wins
            }
          } else if (scheme.type === 'http' && scheme.scheme === 'bearer') {
            if (auth.jwt) {
              headers['Authorization'] = `Bearer ${auth.jwt}`;
              return headers;
            }
          }
        }
      }
    }

    // 2. Fallback for auth-optional endpoints. We try two ways to
    //    identify the caller, in priority order:
    //
    //    a. Cached API key — the canonical bot path. Counts against
    //       the user's per-key daily bucket so /api/me/usage moves.
    //
    //    b. JWT only — the dashboard path that this fixes. After
    //       login on a fresh browser (Incognito, new device, just
    //       cleared cache), there is no cached apiKey on this device
    //       even though the user is logged in. Without this branch
    //       the request shipped no auth at all and the backend
    //       bucketed it as anon-IP, so the user saw 100/day in the
    //       response headers despite the sidebar showing them
    //       signed in. The backend's preHandler now resolves the
    //       JWT → user → user.api_key_id → key row, so this branch
    //       just has to make sure the JWT actually rides along.
    //
    //    Truly-anon callers (no key, no jwt) still hit branch 3,
    //    which is the empty-headers no-op below.
    if (auth.apiKey) {
      headers['X-API-Key'] = auth.apiKey;
    } else if (auth.jwt) {
      headers['Authorization'] = `Bearer ${auth.jwt}`;
    }
    return headers;
  }

  /**
   * Execute a request and return a normalized result.
   *
   * Shape:
   *   {
   *     ok:        boolean,           // 2xx
   *     status:    number,
   *     statusText:string,
   *     headers:   { [k:string]: string },
   *     contentType:string,
   *     // body. Exactly ONE of these is set:
   *     json?:     unknown,           // when content-type is JSON
   *     text?:     string,            // any other text-y type, capped
   *     blob?:     Blob,              // images / binary
   *     blobUrl?:  string,            // object URL for inline preview
   *     // metadata for UI
   *     requestId: string|null,
   *     rateLimit: { limit, remaining, reset } | null,
   *     dailyLimit:{ limit, used, remaining, reset } | null,
   *     retryAfter:number|null,
   *     elapsedMs: number,
   *   }
   */
  async execute({ method, path, query, jsonBody, security, securitySchemes }) {
    const url = new URL(path, window.location.origin);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        url.searchParams.set(k, String(v));
      }
    }

    const headers = {
      Accept: 'application/json, image/*;q=0.9, */*;q=0.5',
      ...this.buildAuthHeaders(security, securitySchemes),
    };

    /** @type {RequestInit} */
    const init = { method, headers, credentials: 'same-origin' };
    if (jsonBody !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(jsonBody);
    }

    const start = performance.now();
    const res = await fetch(url.toString(), init);
    const elapsedMs = Math.round(performance.now() - start);

    const out = {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: this.collectHeaders(res),
      contentType: res.headers.get('content-type') ?? '',
      requestId: res.headers.get('x-request-id'),
      rateLimit: this.parseRateLimit(res),
      dailyLimit: this.parseDailyLimit(res),
      retryAfter: parseInt(res.headers.get('retry-after') ?? '', 10) || null,
      elapsedMs,
    };

    // Branch on content-type so the result pane can do the right thing.
    const ct = out.contentType.toLowerCase();
    if (ct.includes('application/json')) {
      try {
        out.json = await res.json();
      } catch (err) {
        // Server claimed JSON but body was malformed — still useful to show.
        out.text = '<malformed JSON: ' + (err && err.message) + '>';
      }
    } else if (ct.startsWith('image/') || ct.includes('octet-stream')) {
      const blob = await res.blob();
      out.blob = blob;
      out.blobUrl = URL.createObjectURL(blob);
    } else if (ct.startsWith('text/') || ct.includes('html')) {
      const text = await res.text();
      out.text = text.length > ENVELOPE_PREVIEW_BYTES
        ? text.slice(0, ENVELOPE_PREVIEW_BYTES) + '\n…(truncated)'
        : text;
    } else {
      // Empty bodies (204) or unknown types — leave body fields unset.
    }

    return out;
  }

  collectHeaders(res) {
    const out = {};
    res.headers.forEach((v, k) => { out[k] = v; });
    return out;
  }

  parseRateLimit(res) {
    const limit = res.headers.get('ratelimit-limit');
    if (!limit) return null;
    return {
      limit: Number(limit),
      remaining: Number(res.headers.get('ratelimit-remaining') ?? 0),
      reset: Number(res.headers.get('ratelimit-reset') ?? 0),
    };
  }

  parseDailyLimit(res) {
    const limit = res.headers.get('x-daily-limit');
    if (!limit) return null;
    return {
      limit: Number(limit),
      used: Number(res.headers.get('x-daily-used') ?? 0),
      remaining: Number(res.headers.get('x-daily-remaining') ?? 0),
      reset: Number(res.headers.get('x-daily-reset') ?? 0),
    };
  }
}
