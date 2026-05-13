const { createClient } = require('@supabase/supabase-js');

let _client = null;

function isEnabled() {
  return Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function assertEnabled() {
  if (!isEnabled()) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.'
    );
  }
}

/**
 * Lazy singleton — created on first access so tests can mock the module
 * before the client is built. Service-role key is server-only; never expose.
 */
function getClient() {
  assertEnabled();
  if (_client) return _client;
  _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
    global: { headers: { 'x-client-info': 'rex-rest-api' } },
  });
  return _client;
}

function _resetForTests() {
  _client = null;
}

module.exports = {
  isEnabled,
  assertEnabled,
  getClient,
  _resetForTests,
};
