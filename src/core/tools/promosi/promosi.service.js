const logger = require('../../../shared/utils/logger');
const { AppError } = require('../../../shared/utils/errors');

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const PROMPT_TEMPLATE = `
Analisa secara kritis apakah teks berikut termasuk pesan promosi atau tidak dengan ketentuan:

Klasifikasi sebagai PROMOSI jika:
- Mengandung penawaran produk/jasa (diskon, harga spesial, dll)
- Mengajak bergabung/bergabung ke komunitas/server
- Mempromosikan bisnis/usaha tertentu
- Mengandung link/URL yang mengarah ke penjualan
- Mengandung ajakan untuk membeli/menggunakan sesuatu

Klasifikasi sebagai BUKAN PROMOSI jika:
- Hanya menyebut kata "promosi" secara sarkastis/komentar
- Membahas promosi secara umum tanpa mempromosikan sesuatu
- Konten biasa/diskusi umum tanpa unsur penjualan
- Hanya menyebut merek tanpa maksud promosi
- Konten edukatif/informatif tentang produk tanpa ajakan beli

Berikan analisis dengan format:
[Persentase]% - [Penjelasan]

Contoh jawaban:
5% - Hanya menyebut merek dalam konteks diskusi biasa
90% - Mengandung penawaran produk dengan harga spesial

Teks yang dianalisis:
"__TEXT__"
`;

const FALSE_POSITIVE_KEYWORDS = [
  'tidak ada promosi',
  'bukan promosi',
  'diskusi biasa',
  'hanya menyebut',
];

async function promotionDetector(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError('Promotion analysis is unavailable (GEMINI_API_KEY not configured)', 503);
  }

  const cleanedText = text.trim().replace(/"/g, "'");
  const prompt = PROMPT_TEMPLATE.replace('__TEXT__', cleanedText);

  let response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
      // Native fetch ignores the legacy `timeout` option — must use AbortSignal
      // to actually bound the request. Without this the call could hang
      // indefinitely if Gemini drops the connection mid-stream.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Never log the URL (contains the API key in the query string). Only the
    // error name + message is safe to surface.
    logger.error(`[Promosi] Upstream request failed: ${err.name}: ${err.message}`);
    throw new AppError('Promotion analysis upstream unavailable', 502);
  }

  if (!response.ok) {
    logger.error(`[Promosi] Upstream returned ${response.status}`);
    throw new AppError('Promotion analysis upstream rejected request', 502);
  }

  const data = await response.json();
  const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  const match = textResponse?.match(/(\d{1,3})%\s*[-:]\s*(.+)/i);

  if (!match) {
    logger.warn(`[Promosi] Unexpected upstream format: ${textResponse}`);
    return { percentage: 0, reason: 'Format respons tidak dikenali' };
  }

  const percentage = Math.min(100, Math.max(0, parseInt(match[1], 10)));
  const reason = match[2].trim();
  const adjustedPercentage = FALSE_POSITIVE_KEYWORDS.some((keyword) =>
    reason.toLowerCase().includes(keyword)
  )
    ? Math.max(0, percentage - 20)
    : percentage;

  return {
    percentage: adjustedPercentage,
    reason,
    rawResponse: textResponse,
  };
}

module.exports = { promotionDetector };
