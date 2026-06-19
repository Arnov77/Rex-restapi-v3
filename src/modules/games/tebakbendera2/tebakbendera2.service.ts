import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface Tebakbendera2Item {
  img: string;
  name: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/games/tebakbendera2.json');

let cache: Tebakbendera2Item[] | null = null;

function loadData(): Tebakbendera2Item[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as Tebakbendera2Item[];
    return cache;
  } catch {
    throw new AppError(503, 'TEBAKBENDERA2_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomTebakbendera2(): Tebakbendera2Item {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
