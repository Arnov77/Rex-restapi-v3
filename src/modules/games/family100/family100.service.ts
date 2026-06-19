import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface Family100Item {
  soal: string;
  jawaban: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/games/family100.json');

let cache: Family100Item[] | null = null;

function loadData(): Family100Item[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as Family100Item[];
    return cache;
  } catch {
    throw new AppError(503, 'FAMILY100_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomFamily100(): Family100Item {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
