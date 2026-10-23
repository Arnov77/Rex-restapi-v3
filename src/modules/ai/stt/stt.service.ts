import { AppError } from '@shared/errors.js';
import { withGroq } from '@shared/groqRotator.js';
import { ssrfSafeFetch, readBodyCapped } from '@shared/utils/ssrfFetch.js';
import { toFile } from 'groq-sdk';

export interface SttResult {
  text: string;
  language: string | null;
  duration: number | null;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  language?: string,
): Promise<SttResult> {
  return withGroq(async (groq) => {
    const file = await toFile(audioBuffer, filename);

    const result = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3',
      response_format: 'verbose_json',
      ...(language ? { language } : {}),
    });

    if (!result.text) {
      throw new AppError(422, 'STT_EMPTY', 'Tidak ada teks yang terdeteksi dari audio ini');
    }

    return {
      text: result.text.trim(),
      language: (result as any).language ?? null,
      duration: (result as any).duration ?? null,
    };
  });
}

// Groq whisper-large-v3 caps uploads at 25 MB — reject anything bigger
// before buffering it into memory (memory-DoS vector).
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function transcribeFromUrl(url: string, language?: string): Promise<SttResult> {
  // SSRF-safe: the URL and every redirect hop are validated (no
  // private/metadata IPs) before any connection is opened.
  const res = await ssrfSafeFetch(url, { timeoutMs: 60_000 });
  if (!res.ok) throw new AppError(400, 'AUDIO_FETCH_FAILED', `Gagal fetch audio: ${res.status}`);

  const contentType = res.headers.get('content-type') ?? 'audio/mpeg';
  const ext = contentType.includes('ogg') ? 'ogg'
    : contentType.includes('wav') ? 'wav'
    : contentType.includes('webm') ? 'webm'
    : contentType.includes('mp4') ? 'mp4'
    : 'mp3';

  const buffer = await readBodyCapped(res, MAX_AUDIO_BYTES, 'AUDIO_TOO_LARGE');
  return transcribeAudio(buffer, `audio.${ext}`, language);
}
