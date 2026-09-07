/**
 * Shared outbound proxy pool for scraping requests (Instagram/TikTok/GitHub
 * stalk, and anything else that wants to spread outbound traffic across
 * multiple IPs instead of hammering a target from this server's own IP).
 *
 * One env var configures the whole pool: OUTBOUND_PROXY_URLS, a
 * comma-separated list of proxy URLs (e.g.
 * "http://user:pass@host1:port,http://user:pass@host2:port"). Every module
 * that scrapes a third-party site should call getProxyDispatcher() from
 * here rather than reading its own env var, so adding/rotating proxies is
 * a single config change instead of one per endpoint.
 *
 * Dispatchers are cached per proxy URL and reused across requests (cheaper
 * than opening a fresh connection pool every call); call closeAll() on
 * server shutdown to release sockets cleanly.
 */

import { ProxyAgent, type Dispatcher } from 'undici';
import { loadEnv } from '../../config/env.js';

let proxyList: string[] | null = null;
let rrIndex = 0;
const dispatcherCache = new Map<string, ProxyAgent>();

function loadProxies(): string[] {
  if (proxyList !== null) return proxyList;
  const raw = loadEnv().OUTBOUND_PROXY_URLS ?? '';
  proxyList = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return proxyList;
}

/** True if at least one proxy is configured. */
export function hasProxyPool(): boolean {
  return loadProxies().length > 0;
}

/** Picks the next proxy URL from the pool, round-robin. */
function nextProxyUrl(): string | undefined {
  const list = loadProxies();
  if (list.length === 0) return undefined;
  const url = list[rrIndex % list.length];
  rrIndex = (rrIndex + 1) % list.length;
  return url;
}

/**
 * Returns a Dispatcher for the next proxy in the pool (round-robin), or
 * undefined when no proxies are configured — callers should fall back to a
 * direct request (pass `dispatcher: undefined` to fetch, which is a no-op).
 */
export function getProxyDispatcher(): Dispatcher | undefined {
  const url = nextProxyUrl();
  if (!url) return undefined;

  const cached = dispatcherCache.get(url);
  if (cached) return cached;

  const agent = new ProxyAgent(url);
  dispatcherCache.set(url, agent);
  return agent;
}

/** Closes all cached proxy connections. Call once on server shutdown. */
export async function closeAllProxyDispatchers(): Promise<void> {
  const agents = [...dispatcherCache.values()];
  dispatcherCache.clear();
  await Promise.all(agents.map((a) => a.close().catch(() => {})));
}
