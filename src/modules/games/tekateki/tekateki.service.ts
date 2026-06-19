import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface TekatekiItem {
  soal: string;
  jawaban: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/games/tekateki.json');

let cache: TekatekiItem[] | null = null;

function loadData(): TekatekiItem[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as TekatekiItem[];
    return cache;
  } catch {
    throw new AppError(503, 'TEKATEKI_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomTekateki(): TekatekiItem {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
