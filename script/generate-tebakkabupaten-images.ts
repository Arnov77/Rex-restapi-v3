/**
 * generate-tebakkabupaten-images.ts
 *
 * Script SEKALI JALAN (bukan bagian dari runtime API) untuk pre-fetch URL
 * gambar lambang dari Wikipedia/Commons untuk semua 514 kabupaten/kota,
 * lalu menyimpan hasilnya ke data/tebakkabupaten.json — menggantikan URL
 * lama dari feriirawan-api.herokuapp.com yang sudah mati.
 *
 * Strategi 2 lapis per kabupaten:
 *   1. Cari gambar lambang yang DI-EMBED di artikel Wikipedia ID kabupaten
 *      tersebut (prop=images dari halaman artikel).
 *   2. Kalau tidak ketemu (banyak artikel kabupaten infoboxnya tidak
 *      lengkap/tidak nge-link gambar lambang) → FALLBACK cari LANGSUNG di
 *      Wikimedia Commons dengan mencoba beberapa pola nama file standar
 *      ("Lambang Kabupaten X.png", "Seal of X Regency.svg", dst), dan kalau
 *      itu juga gagal, pakai Commons search API sebagai jaring pengaman
 *      terakhir.
 *
 * RESUME MODE: script ini otomatis SKIP entry yang sudah punya `url` terisi
 * dari run sebelumnya. Jadi aman dijalankan berkali-kali — tiap run hanya
 * memproses entry yang masih kosong/gagal.
 *
 * Kenapa pre-fetch, bukan on-demand di endpoint?
 *   - Wikipedia rate-limit (HTTP 429) kalau di-hit berkali-kali dalam waktu
 *     singkat.
 *   - Endpoint /random jadi PASTI INSTANT karena baca dari file JSON lokal.
 *   - Data lambang kabupaten/kota nyaris tidak pernah berubah.
 *
 * Cara jalankan:
 *   npx tsx scripts/generate-tebakkabupaten-images.ts
 *
 * Kalau ada yang masih gagal setelah run pertama, tinggal jalankan lagi —
 * yang sudah berhasil tidak akan diproses ulang.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Sesuaikan path ini kalau struktur folder kamu beda.
const DATA_PATH = join(__dirname, '../data/games/tebakkabupaten.json');

const WIKI_API = 'https://id.wikipedia.org/w/api.php';

// User-Agent SESUAI Wikimedia policy: https://meta.wikimedia.org/wiki/User-Agent_policy
// Wikipedia akan rate-limit lebih agresif / block kalau User-Agent generik
// atau kosong. Ganti <youremail> dengan email/kontak asli kamu (opsional
// tapi direkomendasikan Wikimedia untuk traffic yang lumayan banyak).
const UA = 'RexAPI-TebakKabupaten/1.0 (https://github.com/your-repo; contact@example.com)';

// Delay antar request — Wikipedia API etiquette merekomendasikan max
// ~1 request/detik untuk script non-bot tanpa rate limit khusus.
const DELAY_MS = 1200;

interface TebakkabupatenEntry {
  index: number;
  title: string;
  url: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findSealFilename(filenames: string[], regencyTitle: string): string | null {
  const placeName = regencyTitle.replace(/^(Kabupaten|Kota)\s+/i, '').trim();
  const placeNameLower = placeName.toLowerCase();

  const exactLambang = filenames.find((f) => {
    const lower = f.toLowerCase();
    return lower.includes('lambang') && lower.includes(placeNameLower);
  });
  if (exactLambang) return exactLambang;

  const exactSeal = filenames.find((f) => {
    const lower = f.toLowerCase();
    return (
      (lower.includes('seal_of') || lower.includes('seal of')) &&
      lower.includes(placeNameLower) &&
      (lower.includes('regency') || lower.includes('city'))
    );
  });
  if (exactSeal) return exactSeal;

  const coaWithName = filenames.find((f) => {
    const lower = f.toLowerCase();
    const hasCoaKeyword =
      lower.includes('coat_of_arms') || lower.includes('coat of arms') || /\bcoa[_\s]/.test(lower);
    return hasCoaKeyword && lower.includes(placeNameLower);
  });
  if (coaWithName) return coaWithName;

  return null;
}

async function fetchWithRetry(url: string, maxRetry = 3): Promise<Response | null> {
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });

    if (res.status === 429) {
      // Kena rate limit — tunggu lebih lama lalu retry
      const backoff = DELAY_MS * (attempt + 2) * 2;
      console.warn(`  ⚠ HTTP 429, retry dalam ${backoff}ms (attempt ${attempt + 1}/${maxRetry})`);
      await sleep(backoff);
      continue;
    }

    if (res.ok) return res;

    // Error lain (404, 500, dll) — tidak perlu retry
    return res;
  }
  return null;
}

async function getPageImageFilenames(title: string): Promise<string[]> {
  const url =
    `${WIKI_API}?action=query&titles=${encodeURIComponent(title)}` +
    `&prop=images&imlimit=50&redirects=1&format=json&formatversion=2`;

  const res = await fetchWithRetry(url);
  if (!res || !res.ok) return [];

  const data = (await res.json()) as {
    query?: { pages?: Array<{ missing?: boolean; images?: Array<{ title: string }> }> };
  };

  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.images) return [];

  return page.images.map((img) => img.title);
}

async function getFileUrl(fileTitle: string): Promise<string | null> {
  const url =
    `${WIKI_API}?action=query&titles=${encodeURIComponent(fileTitle)}` +
    `&prop=imageinfo&iiprop=url&format=json&formatversion=2`;

  const res = await fetchWithRetry(url);
  if (!res || !res.ok) return null;

  const data = (await res.json()) as {
    query?: { pages?: Array<{ missing?: boolean; imageinfo?: Array<{ url: string }> }> };
  };

  const page = data.query?.pages?.[0];
  return page?.imageinfo?.[0]?.url ?? null;
}

/**
 * Fallback: cari LANGSUNG di Wikimedia Commons (bukan artikel Wikipedia ID),
 * dengan mencoba beberapa pola nama file standar yang dipakai untuk lambang
 * kabupaten/kota Indonesia.
 *
 * Dipakai ketika artikel Wikipedia ID kabupaten tersebut TIDAK meng-embed
 * gambar lambangnya (banyak artikel kabupaten infoboxnya tidak lengkap),
 * meskipun filenya sendiri ADA di Commons.
 */
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

async function searchCommonsDirectly(regencyTitle: string): Promise<string | null> {
  const isKota = /^Kota\s/i.test(regencyTitle);
  const placeName = regencyTitle.replace(/^(Kabupaten|Kota)\s+/i, '').trim();

  // Kandidat nama file yang umum dipakai di Commons untuk lambang
  // kabupaten/kota Indonesia, dicoba berurutan.
  //
  // Catatan: penamaan TIDAK konsisten di Commons — kadang pakai "Kabupaten"
  // penuh, kadang disingkat "Kab." (contoh ditemukan untuk Aceh:
  // "Lambang Kab. Aceh Barat.png"). Kemungkinan pola ini juga berlaku untuk
  // daerah lain, jadi kedua varian dicoba.
  const candidates = [
    `Lambang Kabupaten ${placeName}.png`,
    `Lambang Kabupaten ${placeName}.jpg`,
    `Lambang Kab. ${placeName}.png`,
    `Lambang Kab. ${placeName}.jpg`,
    `Lambang Kab ${placeName}.png`,
    `Lambang Kota ${placeName}.png`,
    `Lambang Kota ${placeName}.jpg`,
    `Seal of ${placeName} Regency.svg`,
    `Seal of ${placeName} Regency.png`,
    `Seal of ${placeName} City.svg`,
    `Seal of ${placeName} City.png`,
    `COA ${isKota ? 'Kota' : 'Kabupaten'} ${placeName}.png`,
    `COA Kab. ${placeName}.png`,
  ];

  for (const candidate of candidates) {
    const url =
      `${COMMONS_API}?action=query&titles=${encodeURIComponent(`File:${candidate}`)}` +
      `&prop=imageinfo&iiprop=url&format=json&formatversion=2`;

    const res = await fetchWithRetry(url);
    if (!res || !res.ok) continue;

    const data = (await res.json()) as {
      query?: { pages?: Array<{ missing?: boolean; imageinfo?: Array<{ url: string }> }> };
    };

    const page = data.query?.pages?.[0];
    if (page && !page.missing && page.imageinfo?.[0]?.url) {
      return page.imageinfo[0].url;
    }

    await sleep(DELAY_MS);
  }

  // Terakhir: pakai Commons SEARCH API (generator=search) sebagai jaring
  // pengaman kalau nama file tidak mengikuti pola standar di atas.
  const searchQuery = `Lambang ${placeName} OR Seal of ${placeName}`;
  const searchUrl =
    `${COMMONS_API}?action=query&generator=search&gsrnamespace=6` +
    `&gsrsearch=${encodeURIComponent(searchQuery)}&gsrlimit=5` +
    `&prop=imageinfo&iiprop=url&format=json&formatversion=2`;

  const res = await fetchWithRetry(searchUrl);
  if (!res || !res.ok) return null;

  const data = (await res.json()) as {
    query?: { pages?: Array<{ title: string; imageinfo?: Array<{ url: string }> }> };
  };

  const pages = data.query?.pages ?? [];
  const placeNameLower = placeName.toLowerCase();

  // Dari hasil search, ambil yang nama filenya benar-benar mengandung nama daerah
  const match = pages.find((p) => p.title.toLowerCase().includes(placeNameLower));
  return match?.imageinfo?.[0]?.url ?? pages[0]?.imageinfo?.[0]?.url ?? null;
}

async function resolveSealImage(title: string): Promise<string | null> {
  // Strategi 1: cari gambar lambang dari file-file yang di-embed di artikel
  const filenames = await getPageImageFilenames(title);
  const sealFile = findSealFilename(filenames, title);

  if (sealFile) {
    await sleep(DELAY_MS);
    const url = await getFileUrl(sealFile);
    if (url) return url;
  }

  // Strategi 2 (fallback): artikel tidak embed gambar lambang — cari
  // langsung di Commons dengan pola nama file standar.
  console.log(`  ↳ tidak ada di artikel, coba cari langsung di Commons...`);
  return searchCommonsDirectly(title);
}

async function main() {
  console.log(`Membaca data dari: ${DATA_PATH}`);
  const raw = readFileSync(DATA_PATH, 'utf-8');
  const entries = JSON.parse(raw) as TebakkabupatenEntry[];

  // RESUME MODE: skip entry yang url-nya sudah terisi (dari run sebelumnya).
  // Supaya re-run script ini cuma proses yang masih kosong, bukan ulang
  // semua 514 entry dari awal.
  const alreadyDone = entries.filter((e) => e.url && e.url.trim() !== '');
  const todo = entries.filter((e) => !e.url || e.url.trim() === '');

  console.log(`Total ${entries.length} kabupaten/kota.`);
  console.log(`  - ${alreadyDone.length} sudah punya url (di-skip)`);
  console.log(`  - ${todo.length} akan diproses sekarang\n`);

  if (todo.length === 0) {
    console.log('Semua entry sudah punya url. Tidak ada yang perlu diproses.');
    return;
  }

  const results: TebakkabupatenEntry[] = [...alreadyDone];
  const failed: string[] = [];

  for (let i = 0; i < todo.length; i++) {
    const entry = todo[i]!;
    process.stdout.write(`[${i + 1}/${todo.length}] ${entry.title} ... `);

    try {
      const url = await resolveSealImage(entry.title);

      if (url) {
        console.log('✓');
        results.push({ ...entry, url });
      } else {
        console.log('✗ tidak ditemukan');
        failed.push(entry.title);
        results.push({ ...entry, url: '' });
      }
    } catch (err) {
      console.log(`✗ error: ${(err as Error).message}`);
      failed.push(entry.title);
      results.push({ ...entry, url: '' });
    }

    await sleep(DELAY_MS);

    // Simpan progress setiap 25 entry
    if ((i + 1) % 25 === 0) {
      const remaining = todo.slice(i + 1);
      writeFileSync(DATA_PATH, JSON.stringify([...results, ...remaining], null, 2));
      console.log(`  💾 Progress disimpan (${i + 1}/${todo.length})`);
    }
  }

  // Urutkan kembali berdasarkan index asli supaya file JSON tetap rapi
  results.sort((a, b) => a.index - b.index);
  writeFileSync(DATA_PATH, JSON.stringify(results, null, 2));

  console.log('\n─────────────────────────────────────────');
  console.log(`Selesai! ${results.filter((r) => r.url).length}/${entries.length} total berhasil (termasuk yang sudah ada sebelumnya).`);
  if (failed.length > 0) {
    console.log(`\n${failed.length} kabupaten/kota MASIH GAGAL ditemukan lambangnya:`);
    failed.forEach((title) => console.log(`  - ${title}`));
    console.log('\nJalankan ulang script ini untuk retry — entry yang sudah berhasil akan di-skip otomatis.');
  }
}

main().catch((err) => {
  console.error('Script gagal total:', err);
  process.exit(1);
});
