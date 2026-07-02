import { KHODAMS, MESSAGES } from './cekkodam.data.js';
import type { CekKodamQuery, CekKodamResponse } from './cekkodam.schemas.js';

// Simple deterministic hash → seed
function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Mulberry32 PRNG
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

export function cekKodam(opts: CekKodamQuery): CekKodamResponse {
  const name = opts.name.trim();
  const normalized = name.toLowerCase().replace(/\s+/g, ' ');

  const rng = opts.random
    ? Math.random
    : mulberry32(hashSeed(normalized));

  const khodam = KHODAMS[Math.floor(rng() * KHODAMS.length)]!;
  const message = MESSAGES[Math.floor(rng() * MESSAGES.length)]!;
  const power = Math.floor(rng() * 100) + 1;

  return {
    name,
    khodam: khodam.name,
    description: khodam.description,
    power,
    element: khodam.element,
    message,
  };
}