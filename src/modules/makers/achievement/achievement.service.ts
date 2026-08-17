import { createHash } from 'node:crypto';
import sharp from 'sharp';
import minecraftItems, { type MinecraftItem } from 'minecraft-icon-items';
import { withPage } from '@shared/browser/browserManager.js';
import { Internal } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import type { AchievementQuery } from './achievement.schemas.js';
import { renderAchievementHtml } from './achievement.template.js';

export interface AchievementResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  format: 'png' | 'jpeg' | 'webp';
}

export interface AchievementGenerateOptions {
  signal?: AbortSignal;
}

const mc = minecraftItems;

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

const CACHE_MAX = 300;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new LruCache<string, AchievementResult>({
  max: CACHE_MAX,
  ttlMs: CACHE_TTL_MS,
});

const inflight = new Map<string, Promise<AchievementResult>>();

function cacheKey(opts: AchievementQuery): string {
  const sorted = Object.fromEntries(
    Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)),
  );

  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

function normalizeIconName(icon: string): string {
  return icon
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function resolveMinecraftItem(icon: string): MinecraftItem | undefined {
  const raw = icon.trim();
  const normalized = normalizeIconName(raw);
  const spaced = normalized.replaceAll('_', ' ');
  const bukkit = normalized.toUpperCase();

  let item = mc.get(raw);
  if (item?.icon) return item;

  item = mc.get(normalized);
  if (item?.icon) return item;

  item = mc.get(spaced);
  if (item?.icon) return item;

  item = mc.get(titleCaseWords(spaced));
  if (item?.icon) return item;

  item = mc.getBukkit?.(bukkit);
  if (item?.icon) return item;

  const found = mc.find?.(spaced);
  if (found && found.length > 0) {
    const exact =
      found.find((entry) => normalizeIconName(entry.name) === normalized) ??
      found[0];

    if (exact?.icon) return exact;
  }

  return undefined;
}

async function getMinecraftIconDataUri(icon: string): Promise<string> {
  const item = resolveMinecraftItem(icon) ?? resolveMinecraftItem('diamond');

  if (!item?.icon) {
    throw Internal('Failed to load Minecraft item icon');
  }

  const rawBuffer = Buffer.from(item.icon, 'base64');

  const processed = await sharp(rawBuffer)
    .trim()
    .resize(86, 86, {
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return `data:image/png;base64,${processed.toString('base64')}`;
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) lines.push(current);
    current = word;

    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);

  const joinedInput = words.join(' ');
  const joinedLines = lines.join(' ');

  if (lines.length === maxLines && joinedInput.length > joinedLines.length) {
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] = last.length > 3 ? `${last.slice(0, -3)}...` : `${last}...`;
  }

  return lines.length > 0 ? lines : [''];
}

async function renderAchievementHtmlDoc(opts: AchievementQuery): Promise<string> {
  const titleLines = wrapText(opts.title, 22, 1);
  const textLines = wrapText(opts.text, 28, 2);

  const title = titleLines[0] ?? opts.title;
  const text1 = textLines[0] ?? '';
  const text2 = textLines[1] ?? '';
  const iconData = await getMinecraftIconDataUri(opts.icon);

  return renderAchievementHtml({
    title,
    text1,
    text2,
    iconDataUri: iconData,
  });
}

export async function generate(
  opts: AchievementQuery,
  _options: AchievementGenerateOptions = {},
): Promise<AchievementResult> {
  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = renderOnce(opts)
    .then((result) => {
      cache.set(key, result);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

async function renderOnce(opts: AchievementQuery): Promise<AchievementResult> {
  const html = await renderAchievementHtmlDoc(opts);
  // Square 900×900 canvas (the card sits centred inside it — see
  // achievement.template.ts). A forced full-page clip keeps the output
  // dimensions deterministic regardless of how Chromium lays out the inline
  // SVG, and the square aspect lets WhatsApp-square-crop to ~512px without
  // shrinking the card to an illegible sliver.
  const SIDE = 900;

  const png = await withPage(
    async (page) => {
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      // Wait for the embedded Minecraft font to be ready before measuring,
      // matching the smeme/brat convention.
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, { timeout: 5_000 })
        .catch(() => {});

      return page.screenshot({
        type: 'png',
        omitBackground: true,
        clip: { x: 0, y: 0, width: SIDE, height: SIDE },
      });
    },
    { viewport: { width: SIDE, height: SIDE } },
  );

  if (!png || png.length === 0) throw Internal('Achievement produced an empty buffer');

  const input: Buffer = Buffer.isBuffer(png) ? png : Buffer.from(png);

  let buffer: Buffer;

  if (opts.format === 'jpeg') {
    buffer = await sharp(input)
      .flatten({ background: '#111111' })
      .jpeg({ quality: opts.quality })
      .toBuffer();
  } else if (opts.format === 'webp') {
    buffer = await sharp(input)
      .webp({ quality: opts.quality, effort: 3 })
      .toBuffer();
  } else {
    buffer = await sharp(input).png().toBuffer();
  }

  if (!buffer || buffer.length === 0) {
    throw Internal('Achievement produced an empty buffer');
  }

  return {
    buffer,
    mimeType: MIME[opts.format],
    format: opts.format,
  };
}

export const achievementService = {
  generate,
  cache,
};