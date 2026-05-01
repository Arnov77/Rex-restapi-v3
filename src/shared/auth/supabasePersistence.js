const logger = require('../utils/logger');

const TABLES = {
  users: 'rex_users',
  apiKeys: 'rex_api_keys',
  usage: 'rex_usage',
};

function isEnabled() {
  return (
    process.env.AUTH_STORE_BACKEND === 'supabase' &&
    Boolean(process.env.SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

function baseUrl(table) {
  return `${process.env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${table}`;
}

function headers(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function request(table, options = {}) {
  const res = await fetch(baseUrl(table), {
    ...options,
    headers: headers(options.headers),
  });

  if (!res.ok) {
    const details = await res.text().catch(() => '');
    throw new Error(
      `Supabase ${options.method || 'GET'} ${table} failed (${res.status}): ${details}`
    );
  }

  if (res.status === 204) return null;
  return res.json();
}

async function loadRows(table) {
  if (!isEnabled()) return [];
  return request(table, {
    method: 'GET',
    headers: { Prefer: 'return=representation' },
  });
}

async function upsertRows(table, rows) {
  if (!isEnabled() || !rows.length) return;
  await request(table, {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
}

function persistRows(table, rows, label) {
  if (!isEnabled()) return;
  upsertRows(table, rows).catch((err) => {
    logger.error(`[supabase] Failed to persist ${label}: ${err.message}`);
  });
}

module.exports = {
  TABLES,
  isEnabled,
  loadRows,
  persistRows,
  upsertRows,
};
