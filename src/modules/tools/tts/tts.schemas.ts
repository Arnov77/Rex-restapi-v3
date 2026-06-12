import { z } from 'zod';
import { VOICES } from './tts.service.js';

const voiceValues = VOICES.map((v) => v.value) as [string, ...string[]];

export const TtsQuery = z.object({
  text: z.string().min(1).max(3000).describe('Teks yang ingin di-convert ke suara'),
  voice: z.enum(voiceValues).default('id-ID-GadisNeural').describe('Pilih voice'),
  rate: z.string().default('+0%').describe('Kecepatan bicara. Contoh: +20%, -10%'),
  pitch: z.string().default('+0Hz').describe('Nada suara. Contoh: +10Hz, -5Hz'),
});

export type TtsQuery = z.infer<typeof TtsQuery>;

export const TtsResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    text: z.string(),
    voice: z.string(),
    url: z.string(),
    format: z.literal('mp3'),
  }),
});