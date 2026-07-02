import {
  HARI, PASARAN, NEPTU_HARI, NEPTU_PASARAN, WATAK_WETON,
  JODOH_RESULT, SHIO_ORDER, ELEMEN_SHIO, SHIO_START_YEAR, SHIO_LIST,
  ARTI_NAMA_TEMPLATE, SIFAT_POOL, WARNA_POOL,
} from './primbon.data.js';
import type {
  WetonQuery, WetonResponse,
  JodohQuery, JodohResponse,
  ArtiNamaQuery, ArtiNamaResponse,
  ShioQuery, ShioResponse,
} from './primbon.schemas.js';

function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1 Jan 1900 = Senin (day index 1), Pasaran = Pahing (index 1)
const REF = Date.UTC(1900, 0, 1);

export function hitungWeton(opts: WetonQuery): WetonResponse {
  const [y, m, d] = opts.tanggal.split('-').map(Number);
  const target = Date.UTC(y!, (m! - 1), d!);
  if (Number.isNaN(target)) throw new Error('Tanggal tidak valid');
  const diffDays = Math.floor((target - REF) / (24 * 60 * 60 * 1000));
  const hariIdx = ((diffDays % 7) + 7 + 1) % 7; // +1 karena 1 Jan 1900 = Senin
  const pasaranIdx = ((diffDays % 5) + 5 + 1) % 5; // +1 karena Pahing
  const hari = HARI[hariIdx]!;
  const pasaran = PASARAN[pasaranIdx]!;
  const nh = NEPTU_HARI[hari]!;
  const np = NEPTU_PASARAN[pasaran]!;
  return {
    tanggal: opts.tanggal,
    hari,
    pasaran,
    weton: `${hari} ${pasaran}`,
    neptu: { hari: nh, pasaran: np, total: nh + np },
    watak: WATAK_WETON[hari]!,
  };
}

function neptuNama(nama: string): number {
  // sederhana: jumlah kode huruf a-z (1..26)
  let total = 0;
  for (const ch of nama.toLowerCase()) {
    const c = ch.charCodeAt(0);
    if (c >= 97 && c <= 122) total += c - 96;
  }
  return total;
}

export function hitungJodoh(opts: JodohQuery): JodohResponse {
  const n1 = neptuNama(opts.nama1);
  const n2 = neptuNama(opts.nama2);
  const total = n1 + n2;
  const idx = (total % 8);
  const result = JODOH_RESULT[idx]!;
  // Kecocokan deterministik dari total nama
  const rng = mulberry32(hashSeed(`${opts.nama1.toLowerCase()}|${opts.nama2.toLowerCase()}`));
  const base = Math.floor(rng() * 61) + 40; // 40..100
  return {
    nama1: opts.nama1,
    nama2: opts.nama2,
    kecocokan: base,
    kategori: result.key,
    arti: result.arti,
    pesan: result.pesan,
  };
}

export function artiNama(opts: ArtiNamaQuery): ArtiNamaResponse {
  const rng = mulberry32(hashSeed(opts.nama.toLowerCase().trim()));
  const arti = ARTI_NAMA_TEMPLATE[Math.floor(rng() * ARTI_NAMA_TEMPLATE.length)]!;
  const s1 = SIFAT_POOL[Math.floor(rng() * SIFAT_POOL.length)]!;
  const s2 = SIFAT_POOL[Math.floor(rng() * SIFAT_POOL.length)]!;
  const s3 = SIFAT_POOL[Math.floor(rng() * SIFAT_POOL.length)]!;
  const warna = WARNA_POOL[Math.floor(rng() * WARNA_POOL.length)]!;
  const angka = Math.floor(rng() * 99) + 1;
  const hari = HARI[Math.floor(rng() * HARI.length)]!;
  return {
    nama: opts.nama,
    arti,
    sifat: [s1, s2, s3].join(', '),
    keberuntungan: { warna, angka, hari },
  };
}

export function hitungShio(opts: ShioQuery): ShioResponse {
  const idx = ((opts.tahun - SHIO_START_YEAR) % 12 + 12) % 12;
  const shio = SHIO_ORDER[idx]!;
  const meta = SHIO_LIST.find((s) => s.nama === shio)!;
  const elemenIdx = ((opts.tahun - SHIO_START_YEAR) % 10 + 10) % 10;
  return {
    tahun: opts.tahun,
    shio,
    elemen: ELEMEN_SHIO[elemenIdx]!,
    sifat: meta.sifat,
    keberuntungan: meta.hoki,
  };
}