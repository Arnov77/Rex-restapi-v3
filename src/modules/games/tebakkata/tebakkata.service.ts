import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface TebakkataItem {
  index: number;
  soal: string;
  jawaban: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/tebakkata.json');

let cache: TebakkataItem[] | null = null;

function loadData(): TebakkataItem[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as TebakkataItem[];
    return cache;
  } catch {
    throw new AppError(503, 'TEBAKKATA_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomTebakkata(): TebakkataItem {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
