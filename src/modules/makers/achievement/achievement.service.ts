import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import minecraftItems from 'minecraft-icon-items';
import { Internal } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import type { AchievementQuery } from './achievement.schemas.js';

export interface AchievementResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  format: 'png' | 'jpeg' | 'webp';
}

export interface AchievementGenerateOptions {
  signal?: AbortSignal;
}

interface MinecraftItem {
  id: string;
  name: string;
  meta: number;
  type: number;
  icon: string;
}

interface MinecraftItemsApi {
  get(key: string | number): MinecraftItem | undefined;
  find?(key: string | number): MinecraftItem[];
  getBukkit?(key: string): MinecraftItem | undefined;
}

const mc = minecraftItems as MinecraftItemsApi;

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

const __dirname = dirname(fileURLToPath(import.meta.url));

function cacheKey(opts: AchievementQuery): string {
  const sorted = Object.fromEntries(
    Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)),
  );

  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
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

function getFontCss(): string {
  return `
    .mc-title, .mc-body {
      font-family: 'Minecraft', monospace;
      font-weight: normal;
    }
  `;
}

async function renderAchievementSvg(opts: AchievementQuery): Promise<string> {
  const colors = {
    bgTop: '#3f3f3f',
    bgBottom: '#202020',
    outer1: '#787878',
    innerShadow: '#2b2b2b',
    title: '#fffb54',
    text: '#ffffff',
    flatten: '#111111',
  };
  const titleLines = wrapText(opts.title, 22, 1);
  const textLines = wrapText(opts.text, 28, 2);

  const title = esc(titleLines[0] ?? opts.title);
  const text1 = esc(textLines[0] ?? '');
  const text2 = esc(textLines[1] ?? '');
  const iconData = await getMinecraftIconDataUri(opts.icon);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="260" viewBox="0 0 900 260">
  <defs>
    <linearGradient id="cardBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${colors.bgTop}" />
      <stop offset="100%" stop-color="${colors.bgBottom}" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-20%" width="130%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="4" flood-color="rgba(0,0,0,0.35)" />
    </filter>
    <style>
      ${getFontCss()}
    </style>
  </defs>

  <rect width="900" height="260" fill="transparent" />

  <g filter="url(#shadow)">
    <rect x="52" y="78" width="796" height="136" rx="2" fill="${colors.outer1}" />
    <rect x="60" y="86" width="780" height="120" rx="2" fill="url(#cardBg)" />
    <rect x="68" y="94" width="764" height="104" rx="1" fill="none" stroke="${colors.innerShadow}" stroke-width="3" opacity="0.65"/>

    <image
      href="${iconData}"
      x="88"
      y="103"
      width="86"
      height="86"
      preserveAspectRatio="xMidYMid meet"
      image-rendering="pixelated"
    />

    <text
      x="196"
      y="124"
      class="mc-title"
      fill="${colors.title}"
      font-size="30"
      lengthAdjust="spacingAndGlyphs"
    >${title}</text>

    <text
      x="196"
      y="168"
      class="mc-body"
      fill="${colors.text}"
      font-size="28"
      lengthAdjust="spacingAndGlyphs"
    >${text1}</text>

    ${
      text2
        ? `<text
      x="196"
      y="196"
      class="mc-body"
      fill="${colors.text}"
      font-size="24"
      opacity="0.95"
      lengthAdjust="spacingAndGlyphs"
    >${text2}</text>`
        : ''
    }
  </g>
</svg>`;
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
  const svg = await renderAchievementSvg(opts);
  const input = Buffer.from(svg);

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