import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface TebaklogoItem {
  index: string;
  img: string;
  jawaban: string;
  deskripsi: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/games/tebaklogo.json');

let cache: TebaklogoItem[] | null = null;

function loadData(): TebaklogoItem[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as TebaklogoItem[];
    return cache;
  } catch {
    throw new AppError(503, 'TEBAKLOGO_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomTebaklogo(): TebaklogoItem {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
