/**
 * SaveTube resolver for YouTube audio.
 *
 * Backend: SaveTube (save-tube.com) — an independent converter, NOT
 * convert1s (scrapr), NOT cobalt, NOT YouTube-direct. Flow, as implemented
 * by the public npm package @vreden/youtube_scraper 1.2.9:
 *   1. GET https://media.savetube.vip/api/random-cdn -> { cdn }
 *   2. POST https://<cdn>/v2/info { url } -> { data } (AES-128-CBC,
 *      base64; IV = first 16 bytes of the decoded blob)
 *   3. POST https://<cdn>/download { downloadType: 'audio',
 *      quality: '128', key } -> { data: { downloadUrl } }
 *   4. 1-byte Range GET on the download URL — proves the file is really
 *      served by the SaveTube CDN before the URL is handed out.
 *
 * Why this exists: the returned file is a real mp3 hosted on SaveTube's
 * CDN, so the panel fetches it directly (no proxy, no googlevideo) — the
 * chunk-1 wall that kills proxy-ios does not apply here. Proven on the
 * panel 2026-11-19: the walled video IPANK - MUTIARA (0SbnqsQInqE)
 * converts and verifies, same as the Rick Astley control.
 *
 * Notes:
 * - The AES key below is SaveTube's own obfuscation key, hardcoded in the
 *   public npm package — not a credential of ours.
 * - SaveTube is occasionally slow (a 30 s info timeout was seen once);
 *   the whole conversion is retried once before giving up.
 * - No new dependencies: global fetch + node:crypto only.
 */

import { createDecipheriv } from 'node:crypto';

const UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';
const REFERER = 'https://save-tube.com/';
const CDN_LIST_URL = 'https://media.savetube.vip/api/random-cdn';

/** SaveTube's own AES-128-CBC key (public, from @vreden/youtube_scraper). */
const SECRET_KEY_HEX = 'C5D58EF67A7584E4A29F6C35BBC4EB12';

const CDN_TIMEOUT_MS = 30_000;
const INFO_TIMEOUT_MS = 45_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const VERIFY_TIMEOUT_MS = 30_000;
/** Whole-conversion attempts before giving up (SaveTube is flaky). */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2_000;

export interface SavetubeAudioResult {
  audioUrl: string;
  title: string;
  /** Always '128kbps' — the only bitrate this resolver requests. */
  quality: string;
  /** Always 'mp3' — SaveTube returns a real mp3 file. */
  format: string;
}

/** Decrypt the base64 `data` field of a /v2/info response. */
function decodeInfo(enc: string): { key?: string; title?: string } {
  const data = Buffer.from(enc, 'base64');
  const iv = data.subarray(0, 16);
  const content = data.subarray(16);
  const decipher = createDecipheriv('aes-128-cbc', Buffer.from(SECRET_KEY_HEX, 'hex'), iv);
  const plain = Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as { key?: string; title?: string };
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, json };
}

/**
 * Prove the download URL serves the file: request 1 byte, read one
 * chunk, cancel. A dead/expired CDN link fails here instead of 502-ing
 * later at /p/ time. Never downloads more than a chunk.
 */
async function verifyDownloadUrl(url: string): Promise<void> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    headers: { 'User-Agent': UA, Range: 'bytes=0-0' },
    redirect: 'follow',
  });
  if (res.status !== 200 && res.status !== 206) {
    throw new Error(`verify download URL: HTTP ${res.status}`);
  }
  if (!res.body) throw new Error('verify download URL: empty body');
  const reader = res.body.getReader();
  try {
    await reader.read();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** One whole conversion attempt — throws a descriptive error on failure. */
async function convertOnce(videoId: string): Promise<SavetubeAudioResult> {
  const watchUrl = `https://youtube.com/watch?v=${videoId}`;

  const cdnRes = await fetchJson(CDN_LIST_URL, {
    signal: AbortSignal.timeout(CDN_TIMEOUT_MS),
    headers: { 'User-Agent': UA },
  });
  const cdn = (cdnRes.json as { cdn?: string } | null)?.cdn;
  if (cdnRes.status !== 200 || !cdn) {
    throw new Error(`random-cdn: HTTP ${cdnRes.status}`);
  }

  const infoRes = await fetchJson(`https://${cdn}/v2/info`, {
    method: 'POST',
    signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
    headers: { 'User-Agent': UA, Referer: REFERER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: watchUrl }),
  });
  const enc = (infoRes.json as { data?: string } | null)?.data;
  if (infoRes.status !== 200 || !enc) {
    throw new Error(`v2/info: HTTP ${infoRes.status}`);
  }

  let info: { key?: string; title?: string };
  try {
    info = decodeInfo(enc);
  } catch (err) {
    throw new Error(`v2/info: decode gagal: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!info.key) throw new Error('v2/info: tidak ada key');

  const dlRes = await fetchJson(`https://${cdn}/download`, {
    method: 'POST',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: { 'User-Agent': UA, Referer: REFERER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ downloadType: 'audio', quality: '128', key: info.key }),
  });
  const audioUrl = (dlRes.json as { data?: { downloadUrl?: string } } | null)?.data?.downloadUrl;
  if (dlRes.status !== 200 || !audioUrl) {
    throw new Error(`download: HTTP ${dlRes.status}`);
  }

  await verifyDownloadUrl(audioUrl);

  return {
    audioUrl,
    title: info.title || 'YouTube Audio',
    quality: '128kbps',
    format: 'mp3',
  };
}

/**
 * Resolve audio for `videoId` through SaveTube.
 * Retries the whole conversion once (SaveTube is occasionally slow);
 * throws an aggregated error naming every failed attempt.
 */
export async function fetchViaSavetube(videoId: string): Promise<SavetubeAudioResult> {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await convertOnce(videoId);
    } catch (err) {
      failures.push(`attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw new Error(`savetube gagal — ${failures.join('; ')}`);
}
