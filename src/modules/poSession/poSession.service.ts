/**
 * PO session service — pemasok sesi PO token YouTube untuk cobalt.
 *
 * Cobalt (instance lokal) memanggil `POST /get_pot` pada
 * YOUTUBE_SESSION_SERVER tiap beberapa menit dan memakai sesi yang
 * dikembalikan (poToken + visitorData) untuk request YouTube yang
 * dikunci PO token — video yang selama ini balas `error.api.youtube.login`
 * walau cookie sudah lengkap.
 *
 * Panel Pterodactyl hanya mengalokasikan 2 port (aplikasi + cobalt),
 * jadi TIDAK ADA port tersisa untuk session server terpisah. Karena itu
 * endpoint ini hidup DI DALAM aplikasi (port yang sama), dan proses
 * minting-nya dijalankan sebagai proses anak (script mint.mjs di folder
 * po-server/ yang untracked) supaya VM BotGuard selalu mulai bersih
 * dan global JSDOM tidak mengotori proses aplikasi.
 *
 * Keamanan: sesi di-cache (10-60 menit) dan request yang datang hanya
 * membaca cache — murah, dan tokennya terikat IP panel sehingga tidak
 * berguna dari tempat lain. Tidak ada endpoint pemicu regenerasi paksa.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface PoSession {
  poToken: string;
  visitorData: string;
  updated: number;
  ttlSecs: number;
}

export interface PoSessionLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

const NO_LOG: PoSessionLog = { info: () => {}, warn: () => {} };

const MINT_SCRIPT =
  process.env.PO_MINT_PATH || '/home/container/po-server/src/mint.mjs';
// Batas umur cache: pakai TTL integrity token bila masuk akal,
// dibatasi 10-60 menit; default 30 menit bila TTL tak diketahui.
const MIN_TTL_MS = 10 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MINT_TIMEOUT_MS = 120_000;

interface CachedSession extends PoSession {
  expiresAt: number;
}

let cached: CachedSession | null = null;
let minting: Promise<CachedSession | null> | null = null;
let mintMissingLogged = false;

function ttlMs(ttlSecs: number): number {
  const ms = (Number(ttlSecs) || 0) * 1000;
  if (!ms) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ms));
}

function runMint(): Promise<PoSession> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [MINT_SCRIPT], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: resolve(dirname(MINT_SCRIPT), '..'),
      env: process.env,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('mint timeout 120 detik'));
    }, MINT_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (err.trim()) process.stderr.write(err);
      if (code !== 0) {
        reject(new Error(`mint exit ${code}`));
        return;
      }
      try {
        const lastLine = out.trim().split('\n').at(-1) ?? '';
        const session = JSON.parse(lastLine) as PoSession;
        if (!session.poToken || !session.visitorData) {
          throw new Error('mint mengembalikan sesi tak lengkap');
        }
        resolvePromise(session);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/**
 * Ambil sesi saat ini; regenerasi bila belum ada atau kedaluwarsa.
 * Bila regenerasi gagal dan ada sesi lama, sesi lama dipakai terus
 * (cobalt juga me-retry sendiri tiap beberapa menit).
 * Nilai token TIDAK PERNAH ditulis ke log.
 */
export async function getPoSession(log: PoSessionLog = NO_LOG): Promise<CachedSession | null> {
  const fresh = cached && Date.now() < cached.expiresAt;
  if (fresh) return cached;

  if (!existsSync(MINT_SCRIPT)) {
    if (!mintMissingLogged) {
      mintMissingLogged = true;
      log.warn(`po-session: script mint tidak ditemukan di ${MINT_SCRIPT} — /get_pot balas 503 sampai folder po-server/ terpasang.`);
    }
    return cached;
  }

  if (!minting) {
    minting = (async () => {
      try {
        const s = await runMint();
        cached = {
          poToken: s.poToken,
          visitorData: s.visitorData,
          updated: s.updated || Date.now(),
          ttlSecs: s.ttlSecs || 0,
          expiresAt: Date.now() + ttlMs(s.ttlSecs),
        };
        log.info(
          `po-session: sesi baru (panjang token ${s.poToken.length}, umur cache ${Math.round((cached.expiresAt - Date.now()) / 60000)} mnt)`,
        );
      } catch (e) {
        log.warn(`po-session: regenerasi GAGAL: ${e instanceof Error ? e.message : String(e)}`);
        if (!cached) {
          // Tetap null — pemanggil balas 503, cobalt retry nanti.
        }
      } finally {
        minting = null;
      }
      return cached;
    })();
  }
  return minting;
}

/** Bentuk JSON yang diterima cobalt (semua alias field) + klien lain. */
export function poSessionJson(session: CachedSession) {
  return {
    poToken: session.poToken,
    potoken: session.poToken,
    visitor_data: session.visitorData,
    contentBinding: session.visitorData,
    updated: session.updated,
  };
}
