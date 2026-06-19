/**
 * tebakkabupaten.service.ts
 *
 * Data lambang kabupaten/kota sudah di-PRE-FETCH dari Wikipedia (lihat
 * scripts/generate-tebakkabupaten-images.ts) dan disimpan permanen di
 * data/tebakkabupaten.json. Service ini TIDAK melakukan network call sama
 * sekali — murni baca file lokal, sehingga endpoint /random selalu instant
 * dan tidak akan pernah kena rate limit Wikipedia (HTTP 429).
 *
 * Kalau ada kabupaten baru yang field `url`-nya kosong (gagal di-resolve
 * saat generate), entry tersebut otomatis di-skip dari random pool —
 * jalankan ulang script generate untuk mengisi yang kosong.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppError } from '@shared/errors.js';

export interface TebakkabupatenSoal {
  index: number;
  title: string;
  url: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '../../../../data/games/tebakkabupaten.json');

let cache: TebakkabupatenSoal[] | null = null;

function loadData(): TebakkabupatenSoal[] {
  if (cache) return cache;

  let raw: string;
  try {
    raw = readFileSync(DATA_PATH, 'utf-8');
  } catch {
    throw new AppError(503, 'TEBAKKABUPATEN_DATA_NOT_FOUND', `File data tidak ditemukan di: ${DATA_PATH}`);
  }

  const all = JSON.parse(raw) as TebakkabupatenSoal[];

  // Hanya pakai entry yang punya url terisi (hasil generate sukses).
  // Entry dengan url kosong (gagal di-resolve saat generate) di-skip.
  const valid = all.filter((entry) => entry.url && entry.url.trim() !== '');

  if (valid.length === 0) {
    throw new AppError(
      503,
      'TEBAKKABUPATEN_DATA_EMPTY',
      'Tidak ada data kabupaten dengan gambar lambang valid. ' +
        'Jalankan scripts/generate-tebakkabupaten-images.ts terlebih dahulu.',
    );
  }

  cache = valid;
  return cache;
}

export function getRandomTebakkabupaten(): TebakkabupatenSoal {
  const data = loadData();
  return data[Math.floor(Math.random() * data.length)]!;
}