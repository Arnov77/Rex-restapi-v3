import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface TebakkimiaItem {
  unsur: string;
  lambang: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/games/tebakkimia.json');

let cache: TebakkimiaItem[] | null = null;

function loadData(): TebakkimiaItem[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as TebakkimiaItem[];
    return cache;
  } catch {
    throw new AppError(503, 'TEBAKKIMIA_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomTebakkimia(): TebakkimiaItem {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
