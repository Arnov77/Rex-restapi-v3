import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface SusunkataItem {
  index: number;
  soal: string;
  tipe: string;
  jawaban: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/susunkata.json');

let cache: SusunkataItem[] | null = null;

function loadData(): SusunkataItem[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as SusunkataItem[];
    return cache;
  } catch {
    throw new AppError(503, 'SUSUNKATA_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomSusunkata(): SusunkataItem {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
