import { AppError } from '@shared/errors.js';
import { withGroq } from '@shared/groqRotator.js';
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

export async function transcribeFromUrl(url: string, language?: string): Promise<SttResult> {
  const res = await fetch(url);
  if (!res.ok) throw new AppError(400, 'AUDIO_FETCH_FAILED', `Gagal fetch audio: ${res.status}`);

  const contentType = res.headers.get('content-type') ?? 'audio/mpeg';
  const ext = contentType.includes('ogg') ? 'ogg'
    : contentType.includes('wav') ? 'wav'
    : contentType.includes('webm') ? 'webm'
    : contentType.includes('mp4') ? 'mp4'
    : 'mp3';

  const buffer = Buffer.from(await res.arrayBuffer());
  return transcribeAudio(buffer, `audio.${ext}`, language);
}
