import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import rawCoords from './fakeff-template-coordinates.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));

export const TEMPLATES_DIR = join(here, 'assets', 'templates');
export const FONTS_DIR     = join(here, 'assets', 'fonts');

const TEMPLATE_EXT_RE = /\.(png|jpe?g|webp)$/i;
const FONT_EXT_RE     = /\.(ttf|otf|ttc)$/i;

export interface TemplateConfig {
  templateWidth:    number;
  templateHeight:   number;
  xRatio:           number;
  yRatio:           number;
  fontSize:         number;
  maxWidth:         number;
  maxWidthRatio:    number;
  markerLeftRatio:  number;
  markerRightRatio: number;
  strokeWidth:      number;
  color:            string;
  stroke:           string;
  textAlign:        'left' | 'center' | 'right';
}

export const TEMPLATE_CONFIGS: Record<string, TemplateConfig> =
  rawCoords as Record<string, TemplateConfig>;

export const TEMPLATE_IDS = Object.keys(TEMPLATE_CONFIGS);

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function discoverFontFile(): string | null {
  if (!existsSync(FONTS_DIR)) return null;

  const files = readdirSync(FONTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && FONT_EXT_RE.test(entry.name))
    .map((entry) => join(FONTS_DIR, entry.name))
    .sort((a, b) => naturalCompare(a, b));

  return files[0] ?? null;
}

export function getTemplateFile(templateId: string): string {
  // cari file dengan ekstensi apapun yang cocok di TEMPLATES_DIR
  if (!existsSync(TEMPLATES_DIR)) {
    throw new Error(`Templates directory not found: ${TEMPLATES_DIR}`);
  }

  const match = readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && TEMPLATE_EXT_RE.test(e.name))
    .find((e) => basename(e.name, extname(e.name)) === templateId);

  if (!match) {
    throw new Error(`Template file not found for id: ${templateId}`);
  }

  return join(TEMPLATES_DIR, match.name);
}
