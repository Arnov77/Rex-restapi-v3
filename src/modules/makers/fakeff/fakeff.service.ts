import sharp from 'sharp';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Internal } from '@shared/errors.js';
import type { FakeFFQuery } from './fakeff.schemas.js';
import {
  discoverFontFile,
  getTemplateFile,
  TEMPLATE_CONFIGS,
  TEMPLATE_IDS,
} from './fakeff.templates.js';

export interface FakeFFResult {
  buffer:     Buffer;
  mimeType:   'image/png' | 'image/jpeg' | 'image/webp';
  format:     'png' | 'jpeg' | 'webp';
  templateId: string;
}

const MIME = {
  png:  'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

const REGISTERED_FONT_FAMILY = 'FakeFFNameFont';
let registeredFontPath: string | null = null;
let lastTemplateIndex = -1;

function ensureFontRegistered(): void {
  const fontPath = discoverFontFile();

  if (!fontPath) {
    throw Internal(
      'No FakeFF font file found. Put a .ttf/.otf font in assets/fonts/.',
    );
  }

  if (registeredFontPath === fontPath) return;

  const ok = GlobalFonts.registerFromPath(fontPath, REGISTERED_FONT_FAMILY);
  if (!ok) {
    throw Internal(`Failed to register FakeFF font from: ${fontPath}`);
  }

  registeredFontPath = fontPath;
}

function pickRandomTemplateId(): string {
  if (TEMPLATE_IDS.length === 0) {
    throw Internal('No FakeFF templates configured in fakeff-template-coordinates.json.');
  }

  if (TEMPLATE_IDS.length === 1) return TEMPLATE_IDS[0]!;

  let index = 0;
  do {
    index = Math.floor(Math.random() * TEMPLATE_IDS.length);
  } while (index === lastTemplateIndex);

  lastTemplateIndex = index;
  return TEMPLATE_IDS[index]!;
}

function makeNameLayer(text: string, templateId: string): Buffer {
  const cfg = TEMPLATE_CONFIGS[templateId];
  if (!cfg) throw Internal(`No config for template: ${templateId}`);

  const { templateWidth: w, templateHeight: h } = cfg;

  const canvas = createCanvas(w, h);
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // posisi dari ratio
  const x = Math.round(w * cfg.xRatio);
  const y = Math.round(h * cfg.yRatio);

  // maxWidth dari marker kiri-kanan yang independent (bukan simetris dari center)
  const maxWidth = Math.round(w * (cfg.markerRightRatio - cfg.markerLeftRatio));

  // fontSize langsung dalam pixel di resolusi asli template (no scaling)
  let size      = cfg.fontSize;
  const minSize = 8;

  ctx.textAlign    = cfg.textAlign as 'left' | 'center' | 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin     = 'round';
  ctx.miterLimit   = 2;
  ctx.font         = `700 ${size}px "${REGISTERED_FONT_FAMILY}"`;

  // auto-shrink sampai muat di dalam card name
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `700 ${size}px "${REGISTERED_FONT_FAMILY}"`;
  }

  // gradient emas: terang di atas, gelap di bawah (seperti teks FF asli)
  const grad = ctx.createLinearGradient(0, y - size, 0, y);
  grad.addColorStop(0,   '#fff8c0'); // putih keemasan di atas
  grad.addColorStop(0.3, '#f8d96b'); // emas terang
  grad.addColorStop(0.7, '#d4a017'); // emas tengah
  grad.addColorStop(1,   '#8b6000'); // emas gelap di bawah

  ctx.strokeStyle = cfg.stroke;
  ctx.lineWidth   = cfg.strokeWidth;
  ctx.fillStyle   = grad;

  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);

  return canvas.toBuffer('image/png');
}

async function renderOnce(opts: FakeFFQuery): Promise<FakeFFResult> {
  ensureFontRegistered();

  const templateId   = pickRandomTemplateId();
  const templateFile = getTemplateFile(templateId);
  const nameLayer    = makeNameLayer(opts.name.trim(), templateId);

  let pipeline = sharp(templateFile).composite([
    { input: nameLayer, top: 0, left: 0 },
  ]);

  switch (opts.format) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality: opts.quality });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: opts.quality });
      break;
    default:
      pipeline = pipeline.png();
      break;
  }

  return {
    buffer:     await pipeline.toBuffer(),
    mimeType:   MIME[opts.format],
    format:     opts.format,
    templateId,
  };
}

export const fakeffService = {
  generate(opts: FakeFFQuery): Promise<FakeFFResult> {
    return renderOnce(opts);
  },
};
