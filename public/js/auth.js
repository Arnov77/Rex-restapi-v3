/**
 * useAuth() — singleton composable for auth state.
 *
 * State (all reactive):
 *   - jwt: string|null     — Authorization: Bearer <jwt> for /api/me/*
 *   - user: PublicUser|null
 *   - apiKey: string|null  — X-API-Key for everything else
 *   - usage: UsageView|null — today's daily counter (auto-refreshed)
 *
 * Persistence: we keep `jwt` and `apiKey` in localStorage so a refresh
 * keeps you signed in. user/usage are NOT persisted — they're re-fetched
 * after init() so a stale snapshot can never be shown.
 *
 * Why a singleton (one composable, not one-per-component): every part of
 * the UI needs to read auth (the modal needs to inject headers, the
 * sidebar shows user info, the endpoint card hides reveal/regenerate
 * when logged out). A singleton avoids prop-drilling and accidental
 * divergence across components.
 */

import { reactive, computed } from 'vue';

const LS_JWT = 'rex.jwt';
const LS_KEY = 'rex.apiKey';

const state = reactive({
  jwt: localStorage.getItem(LS_JWT),
  apiKey: localStorage.getItem(LS_KEY),
  user: null,
  usage: null,
  // Phase indicator — useful for hiding flicker between "no jwt" and
  // "jwt present, profile fetch pending".
  phase: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  error: null,
});

const isAuthenticated = computed(() => !!state.jwt && !!state.user);

function persist() {
  if (state.jwt) localStorage.setItem(LS_JWT, state.jwt);
  else localStorage.removeItem(LS_JWT);
  if (state.apiKey) localStorage.setItem(LS_KEY, state.apiKey);
  else localStorage.removeItem(LS_KEY);
}

/**
 * Read current snapshot — used by the api client to inject headers per
 * request. Returns plain values (not refs) since the client inspects them
 * synchronously inside the fetch call.
 */
function snapshot() {
  return { jwt: state.jwt, apiKey: state.apiKey };
}

async function jsonFetch(path, init = {}) {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.message ?? `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    err.requestId = res.headers.get('x-request-id');
    throw err;
  }
  return body;
}

/**
 * Boot — when the page loads with a JWT in localStorage, fetch /me to
 * confirm it's still valid and pull fresh profile + key + usage. If the
 * JWT is rejected (401/expired), we clear it silently — same UX as not
 * being logged in. Network errors leave state.error set so the sidebar
 * can show a small "couldn't load" hint instead of pretending logged-in.
 */
async function init() {
  if (!state.jwt) { state.phase = 'idle'; return; }
  state.phase = 'loading';
  try {
    await Promise.all([refreshUser(), refreshUsage()]);
    state.phase = 'ready';
  } catch (err) {
    if (err.status === 401) {
      // Token gone bad — quiet logout.
      doLogout();
      state.phase = 'idle';
    } else {
      state.error = err.message;
      state.phase = 'error';
    }
  }
}

async function refreshUser() {
  const r = await jsonFetch('/api/me', {
    headers: { Authorization: `Bearer ${state.jwt}` },
  });
  state.user = r.data.user;
  // Backend auto-provisions an API key at register-time and stores it
  // *unencrypted-in-DB* (only encrypted-master keys can be revealed). The
  // user gets the plaintext exactly once, on register. Once they log in
  // again, we can only show id/metadata via /api/me/key — the plaintext
  // lives in localStorage on the device(s) that did the login.
  // NOTE: we don't pull the key plaintext from /api/me/key since the
  // unencrypted-user-tier path returns 404 on /reveal anyway.
}

async function refreshUsage() {
  const r = await jsonFetch('/api/me/usage', {
    headers: { Authorization: `Bearer ${state.jwt}` },
  });
  state.usage = r.data;
}

async function login(identifier, password) {
  state.error = null;
  state.phase = 'loading';
  try {
    const r = await jsonFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    state.jwt = r.data.token;
    state.user = r.data.user;
    persist();
    await refreshUsage();
    state.phase = 'ready';
    return { ok: true };
  } catch (err) {
    state.phase = 'idle';
    return { ok: false, message: err.message };
  }
}

async function register(username, email, password) {
  state.error = null;
  state.phase = 'loading';
  try {
    const r = await jsonFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    state.jwt = r.data.token;
    state.user = r.data.user;
    persist();

    // Backend `/auth/register` auto-provisions a user-tier key but does
    // NOT return the plaintext (the response shape is `{ token, user }`,
    // and user-tier keys aren't stored encrypted, so the plaintext is
    // unrecoverable post-creation). To give the new user a working key
    // immediately, we call `/me/key/regenerate` with the password they
    // just entered — same fresh password, no extra prompt. The cost is
    // one extra RTT at registration time. Far better UX than "you're
    // registered, now go to settings to mint a key".
    try {
      await regenerateKey(password);
    } catch {
      // Don't fail the registration if the seed-key step misbehaves —
      // the user can always regenerate manually from the sidebar.
    }
    await refreshUsage().catch(() => {});
    state.phase = 'ready';
    return { ok: true };
  } catch (err) {
    state.phase = 'idle';
    return { ok: false, message: err.message };
  }
}

/**
 * Save a fresh API key plaintext into local state + localStorage so the
 * playground starts using it immediately (no page reload needed). Called
 * after a successful regenerate.
 */
function setApiKey(plaintext) {
  state.apiKey = plaintext;
  persist();
}

async function regenerateKey(password) {
  const r = await jsonFetch('/api/me/key/regenerate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.jwt}` },
    body: JSON.stringify({ password }),
  });
  setApiKey(r.data.plaintext);
  // Usage counter is keyed by apiKey id (preserved across regenerate per
  // service contract), but refresh anyway so the bar is in sync.
  refreshUsage().catch(() => {});
  return r.data;
}

/**
 * Wipe ALL credential state — JWT, API key, profile, usage — from
 * memory and localStorage. Returns the playground to a true anonymous
 * state.
 *
 * Why we now clear apiKey on logout (we used to keep it):
 *
 * The api client's buildAuthHeaders attaches a cached X-API-Key
 * opportunistically even on endpoints that don't declare `security`,
 * so anonymous-feeling routes (screenshot, brat, quote) get counted
 * against the user's daily key bucket instead of the per-IP anon
 * bucket. That behaviour is correct and intentional — it's what makes
 * /api/me/usage actually move when the dashboard hits an endpoint.
 *
 * The side effect is that *any* cached apiKey acts as a credential.
 * If logout left the key in localStorage, every subsequent request
 * from this device kept being identified as the just-logged-out user,
 * and the rate-limit headers reported the user-tier budget (1000/day,
 * 60/min) instead of the anon budget (100/day, 30/min). To the user
 * that looks like "I'm logged out but the system thinks I'm not" —
 * exactly the leak we were seeing.
 *
 * The old "keep the key, the bot uses it too" rationale doesn't apply:
 * the bot stores its own copy of the key (the user pasted it there
 * once after registration), and the dashboard's local cache is purely
 * for our own auto-injection. Clearing here doesn't revoke the key
 * server-side; it just stops THIS browser tab from presenting it. If
 * the user wants the key invalidated everywhere, /profile → Regenerate
 * is still the explicit action that does that.
 */
function doLogout() {
  state.jwt = null;
  state.apiKey = null;
  state.user = null;
  state.usage = null;
  state.error = null;
  state.phase = 'idle';
  persist();
}

export function useAuth() {
  return {
    state,
    isAuthenticated,
    snapshot,
    init,
    login,
    register,
    regenerateKey,
    refreshUsage,
    setApiKey,
    logout: doLogout,
  };
}
