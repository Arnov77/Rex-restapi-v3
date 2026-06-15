import { AppError } from '@shared/errors.js';
import { withGemini } from '@shared/geminiRotator.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';

export interface OcrResult {
  text: string;
  language: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  lines: number | null;
}

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
] as const;

type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

function buildPrompt(lang?: string): string {
  const langHint = lang ? ` Teks kemungkinan besar dalam bahasa dengan kode ISO 639-1: "${lang}".` : '';

  return `Kamu adalah mesin OCR (Optical Character Recognition) yang sangat akurat.${langHint}

Tugasmu adalah mengekstrak teks yang terlihat dalam gambar ini dengan aturan berikut:
1. Gabungkan kata yang terpotong karena line break (contoh: "Connec-\\ntion" → "Connection", "timed\\nout" → "timed out")
2. Pertahankan struktur paragraf/section yang logis, pisahkan dengan baris baru
3. Hapus noise: angka acak yang tidak relevan (nomor baris, koordinat piksel, UI counter), tanda baca berulang
4. Jangan hapus angka yang merupakan bagian dari konten (kode error, tanggal, waktu, nomor versi, dll)

Balas HANYA dengan JSON valid (tanpa markdown, tanpa backtick, tanpa penjelasan) dengan format berikut:
{
  "text": "<teks hasil OCR yang sudah dibersihkan, gunakan \\n untuk pemisah baris yang logis>",
  "language": "<kode ISO 639-1 bahasa dominan, atau null jika tidak bisa dideteksi>",
  "confidence": "<'high' | 'medium' | 'low' berdasarkan kualitas gambar dan kejelasan teks>",
  "lines": <jumlah baris teks sebagai integer, atau null>
}

Jika gambar tidak mengandung teks sama sekali, kembalikan:
{
  "text": "",
  "language": null,
  "confidence": "high",
  "lines": 0
}`;
}

function cleanText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')
    .trim();
}

function parseGeminiResponse(raw: string): OcrResult {
  // Bersihkan markdown fence jika ada
  const cleaned = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Jika JSON gagal parse, kembalikan raw text sebagai fallback
    return {
      text: raw.trim(),
      language: null,
      confidence: 'low',
      lines: null,
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new AppError(502, 'OCR_PARSE_FAILED', 'Respons Gemini tidak valid');
  }

  const p = parsed as Record<string, unknown>;

  const rawText = typeof p['text'] === 'string' ? p['text'] : '';
  const text = cleanText(rawText);
  const language = typeof p['language'] === 'string' ? p['language'] : null;
  const confidence =
    p['confidence'] === 'high' || p['confidence'] === 'medium' || p['confidence'] === 'low'
      ? p['confidence']
      : null;

  // Hitung ulang lines dari text yang sudah dibersihkan
  const actualLines = text.split('\n').filter((l) => l.trim().length > 0).length;
  const lines = actualLines > 0 ? actualLines : null;

  return { text, language, confidence, lines };
}

// ─── OCR dari Buffer ──────────────────────────────────────────────────────────

export async function ocrFromBuffer(buffer: Buffer, mimeType: string, lang?: string): Promise<OcrResult> {
  if (!isAllowedMime(mimeType)) {
    throw new AppError(400, 'OCR_UNSUPPORTED_TYPE', `Tipe file tidak didukung: ${mimeType}. Gunakan JPEG, PNG, WebP, GIF, BMP, TIFF, HEIC, atau HEIF.`);
  }

  const base64 = buffer.toString('base64');

  return withGemini(async (ai) => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64,
              },
            },
            {
              text: buildPrompt(lang),
            },
          ],
        },
      ],
    });

    const raw = response.text ?? '';
    if (!raw.trim()) {
      throw new AppError(502, 'OCR_EMPTY_RESPONSE', 'Gemini tidak menghasilkan respons');
    }

    return parseGeminiResponse(raw);
  });
}

// ─── OCR dari URL ─────────────────────────────────────────────────────────────

export async function ocrFromUrl(imageUrl: string, lang?: string): Promise<OcrResult> {
  await assertPublicUrl(imageUrl);

  // Deteksi mime type dari URL
  const res = await fetch(imageUrl, { method: 'HEAD' });
  if (!res.ok) {
    throw new AppError(400, 'OCR_FETCH_FAILED', `Gagal mengambil gambar dari URL: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  const mimeType = contentType.split(';')[0]?.trim() ?? 'image/jpeg';

  // Pakai file_uri langsung — lebih efisien, tidak perlu download + base64
  return withGemini(async (ai) => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                mimeType,
                fileUri: imageUrl,
              },
            },
            {
              text: buildPrompt(lang),
            },
          ],
        },
      ],
    });

    const raw = response.text ?? '';
    if (!raw.trim()) {
      throw new AppError(502, 'OCR_EMPTY_RESPONSE', 'Gemini tidak menghasilkan respons');
    }

    return parseGeminiResponse(raw);
  });
}