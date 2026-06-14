/**
 * manga.service.ts
 * Scraper untuk komiku.org — search & detail manga.
 */

import { AppError } from '@shared/errors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MangaItem {
  title: string;
  url: string;
  thumbnail: string | null;
  type: string | null;
  genre: string | null;
  latestChapter: string | null;
}

export interface MangaChapter {
  title: string;
  url: string;
}

export interface MangaDetail {
  title: string;
  alternativeTitle: string | null;
  url: string;
  thumbnail: string | null;
  type: string | null;
  theme: string | null;
  genres: string[];
  author: string | null;
  status: string | null;
  rating: string | null;
  views: string | null;
  synopsis: string | null;
  chapters: MangaChapter[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = 'https://komiku.org';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://komiku.org/',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
};

async function fetchHtml(url: string): Promise<string> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new AppError(400, 'INVALID_URL', `URL tidak valid: ${url}`);
  }

  const res = await fetch(parsedUrl.toString(), {
    headers: HEADERS,
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new AppError(
      502,
      'UPSTREAM_ERROR',
      `Komiku returned HTTP ${res.status} untuk URL: ${parsedUrl.toString()}`,
    );
  }

  return res.text();
}

/**
 * Resolve input q ke URL detail manga yang valid.
 *
 * Urutan prioritas:
 *  1. Full URL komiku.org  → langsung pakai
 *  2. Path /manga/slug     → tambah BASE
 *  3. Slug murni (huruf/angka/tanda-hubung, tanpa spasi) → coba /manga/<slug>/
 *  4. Keyword bebas        → search dulu, ambil URL hasil pertama
 */
async function resolveDetailUrl(q: string): Promise<string> {
  const trimmed = q.trim().replace(/\/$/, '');

  // 1. Full URL
  if (trimmed.startsWith('https://komiku.org') || trimmed.startsWith('http://komiku.org')) {
    return trimmed.endsWith('/') ? trimmed : trimmed + '/';
  }

  // 2. Path absolut
  if (trimmed.startsWith('/manga/')) {
    return `${BASE}${trimmed}/`;
  }

  // 3. Slug murni: hanya huruf, angka, tanda hubung — tidak ada spasi
  const isSlug = /^[a-z0-9-]+$/i.test(trimmed);
  if (isSlug) {
    return `${BASE}/manga/${trimmed}/`;
  }

  // 4. Keyword bebas → search, ambil yang judulnya paling mirip query
  const results = await searchManga(trimmed);
  if (!results.length) {
    throw new AppError(404, 'NOT_FOUND', `Tidak ada manga ditemukan untuk kata kunci: "${trimmed}"`);
  }

  const lowerQ = trimmed.toLowerCase();

  function scoreTitle(title: string): number {
    const t = title.toLowerCase();
    if (t === lowerQ) return 100;
    if (t.startsWith(lowerQ)) return 80;
    if (lowerQ.startsWith(t)) return 70;
    if (t.includes(lowerQ)) return 60;
    // Hitung karakter query yang muncul berurutan di title
    let i = 0;
    for (const ch of t) { if (i < lowerQ.length && ch === lowerQ[i]) i++; }
    return (i / lowerQ.length) * 40;
  }

  const best = results.reduce((a, b) => scoreTitle(a.title) >= scoreTitle(b.title) ? a : b);
  return best.url;
}

/**
 * Ambil teks di antara dua marker (pertama ditemukan).
 */
function between(str: string, start: string, end: string): string | null {
  const si = str.indexOf(start);
  if (si === -1) return null;
  const ei = str.indexOf(end, si + start.length);
  if (ei === -1) return null;
  return str.slice(si + start.length, ei);
}

/**
 * Ambil semua teks di antara dua marker.
 */
function allBetween(str: string, start: string, end: string): string[] {
  const results: string[] = [];
  let cursor = 0;
  while (cursor < str.length) {
    const si = str.indexOf(start, cursor);
    if (si === -1) break;
    const ei = str.indexOf(end, si + start.length);
    if (ei === -1) break;
    results.push(str.slice(si + start.length, ei));
    cursor = ei + end.length;
  }
  return results;
}

/**
 * Ambil konten dalam tag: dari penutup '>' pertama sampai tag tutup.
 * Contoh: '<td class="foo">teks</td>' → 'teks'
 */
function tagContent(raw: string): string {
  const gt = raw.indexOf('>');
  if (gt === -1) return raw;
  return raw.slice(gt + 1);
}

function stripTags(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim();
}

function decodeEntities(str: string): string {
  return str
    .replace(/&#0*38;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function clean(str: string | null | undefined): string | null {
  if (!str) return null;
  return decodeEntities(stripTags(str)).replace(/\s+/g, ' ').trim() || null;
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Parse card manga dari HTML (search page atau daftar-komik).
 * Tidak bergantung pada class tertentu — ambil semua link /manga/ lalu
 * ekstrak judul & metadata dari konteks sekitar link.
 */
function parseMangaCards(html: string, filterQuery: string | null): MangaItem[] {
  const out: MangaItem[] = [];
  const seen = new Set<string>();
  const lq = filterQuery?.toLowerCase() ?? null;

  // Split per card — setiap card dibatasi oleh <div class="bge">
  const cardMarker = '<div class="bge">';
  const cards: string[] = [];
  let cursor = 0;
  while (true) {
    const start = html.indexOf(cardMarker, cursor);
    if (start === -1) break;
    const next = html.indexOf(cardMarker, start + cardMarker.length);
    cards.push(html.slice(start, next === -1 ? html.length : next));
    cursor = next === -1 ? html.length : next;
  }

  for (const block of cards) {
    // URL manga: link pertama yang ke /manga/
    const href = between(block, 'href="', '"');
    if (!href?.includes('/manga/')) continue;
    const mangaUrl = href.startsWith('http') ? href : `${BASE}${href}`;
    if (seen.has(mangaUrl)) continue;

    // Judul: h3 atau h4, fallback ke alt img
    let title: string | null =
      clean(between(block, '<h3>', '</h3>')) ??
      clean(between(block, '<h4>', '</h4>')) ??
      clean(between(block, ' alt="', '"'));
    if (!title) continue;
    if (lq && !title.toLowerCase().includes(lq)) continue;

    seen.add(mangaUrl);

    // Thumbnail
    let thumbnail: string | null = null;
    const imgTag = between(block, '<img', '>') ?? '';
    const rawThumb = between(imgTag, 'src="', '"') ?? null;
    if (rawThumb && !rawThumb.includes('lazy') && rawThumb.startsWith('http')) {
      thumbnail = decodeEntities(rawThumb);
    }

    // Type & genre dari tpe1_inf: <b>Type</b> Genre
    let type: string | null = null;
    let genre: string | null = null;
    const tpeBlock = between(block, 'class="tpe1_inf">', '</div>');
    if (tpeBlock) {
      type = clean(between(tpeBlock, '<b>', '</b>'));
      const afterB = tpeBlock.slice((tpeBlock.indexOf('</b>') + 4));
      genre = clean(afterB) || null;
    }

    // Latest chapter: div.new1 yang ada "Terbaru:", fallback ke satu-satunya new1
    let latestChapter: string | null = null;
    const new1Blocks = allBetween(block, 'class="new1">', '</div>');
    const terbaruBlock = new1Blocks.find((b) => b.includes('Terbaru:'));
    const targetBlock = terbaruBlock ?? new1Blocks[new1Blocks.length - 1];
    if (targetBlock) {
      const spans = allBetween(targetBlock, '<span>', '</span>');
      const last = spans[spans.length - 1];
      latestChapter = clean(last) ?? null;
    }

    out.push({ title, url: mangaUrl, thumbnail, type, genre, latestChapter });
  }

  return out;
}

export async function searchManga(query: string): Promise<MangaItem[]> {
  // Scrape search page komiku.org langsung — WP REST API di-skip karena
  // redirect ke secure.komikid.org yang diblokir.
  // Komiku load hasil search via htmx dari subdomain api.komiku.org
  // Komiku load hasil search via htmx dari subdomain api.komiku.org
  const searchUrl = `https://api.komiku.org/?s=${encodeURIComponent(query)}&post_type=manga`;
  const searchHtml = await fetchHtml(searchUrl);

  const results = parseMangaCards(searchHtml, null);
  if (results.length > 0) return results;

  // Fallback: daftar-komik per huruf pertama, filter manual
  const firstChar = query.trim()[0]?.toUpperCase() ?? 'A';
  const listUrl = `${BASE}/daftar-komik/?huruf=${encodeURIComponent(firstChar)}`;
  const listHtml = await fetchHtml(listUrl);
  return parseMangaCards(listHtml, query);
}


export async function getMangaDetail(q: string): Promise<MangaDetail> {
  const mangaUrl = await resolveDetailUrl(q);
  const html = await fetchHtml(mangaUrl);

  // ── Title ────────────────────────────────────────────────────────────────
  let title =
    clean(between(html, '<h1 class="komik_info-content-body-title">', '</h1>')) ??
    clean(between(html, '<h1>', '</h1>')) ??
    clean(between(html, 'property="og:title" content="', '"'));

  if (!title) throw new AppError(404, 'NOT_FOUND', 'Manga tidak ditemukan');
  title = title.replace(/^Komik\s+/i, '').trim();

  // ── Thumbnail ────────────────────────────────────────────────────────────
  const thumbnail: string | null =
    between(html, 'property="og:image" content="', '"') ??
    between(html, 'property="og:image:secure_url" content="', '"') ??
    null;

  // ── Info table ───────────────────────────────────────────────────────────
  // Ambil seluruh blok tabel info manga
  const tableHtml =
    between(html, 'class="komik_info-content-info"', '</table>') ??
    between(html, '<table', '</table>') ??
    '';

  // Parse tiap <tr>…</tr>
  const rows = allBetween(tableHtml, '<tr', '</tr>');

  /**
   * Cari baris yang mengandung label, lalu ambil konten <td> kedua.
   * allBetween '<td' '</td>' menghasilkan string yang MASIH mengandung
   * atribut tag (misal: ' class="foo">teks'). Gunakan tagContent() untuk
   * skip ke konten setelah '>'.
   */
  function getRowValue(labelSubstr: string): string | null {
    for (const row of rows) {
      if (!row.toLowerCase().includes(labelSubstr.toLowerCase())) continue;
      const tds = allBetween(row, '<td', '</td>');
      if (tds.length < 2) continue;
      return clean(tagContent(tds[1]));
    }
    return null;
  }

  const alternativeTitle = getRowValue('Alternatif') ?? getRowValue('alternative');
  const type = getRowValue('Tipe') ?? getRowValue('Type');
  const theme = getRowValue('Tema') ?? getRowValue('Theme');
  const author = getRowValue('Author') ?? getRowValue('Penulis');
  const status = getRowValue('Status');
  const rating = getRowValue('Rating');
  const views = getRowValue('Pembaca') ?? getRowValue('Views');

  // ── Genres ───────────────────────────────────────────────────────────────
  let genres: string[] = [];
  const genreRow = rows.find(
    (r) => r.toLowerCase().includes('genre') && r.includes('href'),
  );
  if (genreRow) {
    const tds = allBetween(genreRow, '<td', '</td>');
    const genreTd = tds.length >= 2 ? tagContent(tds[1]) : tagContent(genreRow);
    // Ambil teks di dalam setiap <a>…</a>
    genres = allBetween(genreTd, '<a', '</a>')
      .map((a) => clean(tagContent(a)))
      .filter((s): s is string => s !== null && s.length > 0);
  }

  // ── Synopsis ─────────────────────────────────────────────────────────────
  // Komiku meletakkan sinopsis di <p itemprop="description"> atau <div class="nfx">
  const synopsisRaw =
    between(html, 'itemprop="description">', '</p>') ??
    between(html, 'itemprop="description">', '</div>') ??
    between(html, 'class="komik_info-description-sinopsis">', '</p>') ??
    between(html, 'class="komik_info-description-sinopsis">', '</div>') ??
    between(html, '<div class="nfx">', '</div>') ??
    null;
  const synopsis = clean(synopsisRaw);

  // ── Chapters ─────────────────────────────────────────────────────────────
  // Cari kontainer daftar chapter
  const chapterContainer =
    between(html, 'class="chapter_list"', '</ul>') ??
    between(html, 'class="ls3"', '</div>') ??
    between(html, 'id="Daftar_Chapter"', '</section>') ??
    html;

  const chapters: MangaChapter[] = [];
  const seenUrls = new Set<string>();

  // Tiap item chapter: <a href="/slug-chapter-N/" ...>Chapter N</a>
  // allBetween '<a ' '</a>' → masih ada atribut, pakai tagContent() untuk teks
  const chapterTags = allBetween(chapterContainer, '<a ', '</a>');
  for (const tag of chapterTags) {
    const href = between(tag, 'href="', '"');
    if (!href || !href.includes('-chapter-')) continue;

    const chapterUrl = href.startsWith('http') ? href : `${BASE}${href}`;
    if (seenUrls.has(chapterUrl)) continue;
    seenUrls.add(chapterUrl);

    // Teks chapter: konten setelah '>' penutup tag <a …>
    const chapterTitle = clean(tagContent(tag));
    if (chapterTitle) {
      chapters.push({ title: chapterTitle, url: chapterUrl });
    }
  }

  return {
    title,
    alternativeTitle,
    url: mangaUrl,
    thumbnail,
    type,
    theme,
    genres,
    author,
    status,
    rating,
    views,
    synopsis,
    chapters,
  };
}