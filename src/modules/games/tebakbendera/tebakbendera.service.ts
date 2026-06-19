import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface TebakbenderaItem {
  flag: string;
  img: string;
  name: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/tebakbendera.json');

let cache: TebakbenderaItem[] | null = null;

function loadData(): TebakbenderaItem[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    cache = JSON.parse(raw) as TebakbenderaItem[];
    return cache;
  } catch {
    throw new AppError(503, 'TEBAKBENDERA_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }
}

export function getRandomTebakbendera(): TebakbenderaItem {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}
