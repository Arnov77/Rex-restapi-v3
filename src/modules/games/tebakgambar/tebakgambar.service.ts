import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface TebakgambarItem {
  index: number;
  img: string;
  jawaban: string;
  deskripsi: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/games/tebakgambar.json');

let cache: TebakgambarItem[] | null = null;

function loadData(): TebakgambarItem[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as TebakgambarItem[];
    return cache;
  } catch {
    throw new AppError(503, 'TEBAKGAMBAR_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomTebakgambar(): TebakgambarItem {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
