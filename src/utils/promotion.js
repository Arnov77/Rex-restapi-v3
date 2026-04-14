async function promotionDetector(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  const cleanedText = text.trim().replace(/"/g, "'");

  const prompt = `
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
  "${cleanedText}"
  `;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }],
        }],
      }),
      timeout: 10000,
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();
    const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const match = textResponse?.match(/(\d{1,3})%\s*[-:]\s*(.+)/i);

    if (!match) {
      console.error('Unexpected API response format:', textResponse);
      return { percentage: 0, reason: 'Format respons tidak dikenali' };
    }

    const percentage = Math.min(100, Math.max(0, parseInt(match[1], 10)));
    const reason = match[2].trim();
    const falsePositiveKeywords = ['tidak ada promosi', 'bukan promosi', 'diskusi biasa', 'hanya menyebut'];

    const adjustedPercentage = falsePositiveKeywords.some((keyword) =>
      reason.toLowerCase().includes(keyword)
    )
      ? Math.max(0, percentage - 20)
      : percentage;

    return {
      percentage: adjustedPercentage,
      reason,
      rawResponse: textResponse,
    };
  } catch (error) {
    console.error('Error in promotion detection:', error);
    return {
      percentage: 0,
      reason: 'Error dalam memproses permintaan',
      error: error.message,
    };
  }
}

module.exports = { promotionDetector };
