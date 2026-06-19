import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface AsahotakItem {
  index: number;
  soal: string;
  jawaban: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/asahotak.json');

let cache: AsahotakItem[] | null = null;

function loadData(): AsahotakItem[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as AsahotakItem[];
    return cache;
  } catch {
    throw new AppError(503, 'ASAHOTAK_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomAsahotak(): AsahotakItem {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
