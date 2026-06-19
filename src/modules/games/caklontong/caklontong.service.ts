import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface CaklontongItem {
  index: number;
  soal: string;
  jawaban: string;
  deskripsi: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/caklontong.json');

let cache: CaklontongItem[] | null = null;

function loadData(): CaklontongItem[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as CaklontongItem[];
    return cache;
  } catch {
    throw new AppError(503, 'CAKLONTONG_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomCaklontong(): CaklontongItem {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
