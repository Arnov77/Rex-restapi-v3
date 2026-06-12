import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { AppError } from '@shared/errors.js';

export const VOICES = [
  // Indonesia
  { value: 'id-ID-GadisNeural',   label: '🇮🇩 Gadis (Female)' },
  { value: 'id-ID-ArdiNeural',    label: '🇮🇩 Ardi (Male)' },
  // English
  { value: 'en-US-JennyNeural',   label: '🇺🇸 Jenny (Female)' },
  { value: 'en-US-GuyNeural',     label: '🇺🇸 Guy (Male)' },
  { value: 'en-GB-SoniaNeural',   label: '🇬🇧 Sonia (Female)' },
  { value: 'en-GB-RyanNeural',    label: '🇬🇧 Ryan (Male)' },
  // Japanese
  { value: 'ja-JP-NanamiNeural',  label: '🇯🇵 Nanami (Female)' },
  { value: 'ja-JP-KeitaNeural',   label: '🇯🇵 Keita (Male)' },
  // Korean
  { value: 'ko-KR-SunHiNeural',   label: '🇰🇷 SunHi (Female)' },
  { value: 'ko-KR-InJoonNeural',  label: '🇰🇷 InJoon (Male)' },
  // Arabic
  { value: 'ar-SA-ZariyahNeural', label: '🇸🇦 Zariyah (Female)' },
  { value: 'ar-SA-HamedNeural',   label: '🇸🇦 Hamed (Male)' },
  // Chinese
  { value: 'zh-CN-XiaoxiaoNeural', label: '🇨🇳 Xiaoxiao (Female)' },
  { value: 'zh-CN-YunxiNeural',   label: '🇨🇳 Yunxi (Male)' },
] as const;

export type VoiceValue = typeof VOICES[number]['value'];

export async function generateTts(
  text: string,
  voice: string,
  rate: string,
  pitch: string,
): Promise<Buffer> {
  const tts = new MsEdgeTTS();

  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  } catch {
    throw new AppError(400, 'TTS_INVALID_VOICE', `Voice "${voice}" tidak valid atau tidak tersedia`);
  }

  const ssmlRate  = rate.startsWith('+') || rate.startsWith('-') ? rate : `+${rate}`;
  const ssmlPitch = pitch.startsWith('+') || pitch.startsWith('-') ? pitch : `+${pitch}`;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const { audioStream } = tts.toStream(text, {
      rate: ssmlRate,
      pitch: ssmlPitch,
    });

    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    audioStream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        return reject(new AppError(502, 'TTS_EMPTY', 'Edge TTS tidak mengembalikan audio'));
      }
      resolve(buffer);
    });
    audioStream.on('error', (err: Error) => {
      reject(new AppError(502, 'TTS_STREAM_ERROR', `Edge TTS error: ${err.message}`));
    });
  });
}
