import { BadRequest } from '@shared/errors.js';
import { ytdlpGetInfo } from '../youtube/ytdlp.js';

export interface PinterestResult {
  id: string;
  title: string | null;
  description: string | null;
  author: { name: string; username: string };
  board: string | null;
  thumbnail: string | null;
  media: Array<{ type: 'image' | 'video'; url: string; quality?: string }>;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Resolve pin.it short URL dan normalisasi ke www.pinterest.com. */
async function resolveUrl(url: string): Promise<{ pinId: string; canonical: string }> {
  let resolved = url;

  if (/pin\.it/i.test(url)) {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA } });
    resolved = res.url || url;
  }

  const match = resolved.match(/\/pin\/(\d+)/i);
  if (!match?.[1]) throw BadRequest('Tidak bisa mengekstrak pin ID dari URL ini');

  const pinId = match[1];
  return { pinId, canonical: `https://www.pinterest.com/pin/${pinId}/` };
}

/** Fallback: image pin via oEmbed + konstruksi URL dari CDN pattern. */
async function scrapeImagePin(pinId: string): Promise<PinterestResult> {
  const oembedUrl = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(`https://www.pinterest.com/pin/${pinId}/`)}`;
  const res = await fetch(oembedUrl, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  });

  if (!res.ok) throw new Error(`oEmbed gagal: ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text) as any;

  const thumbnail = data.thumbnail_url as string | undefined;
  if (!thumbnail) throw new Error('Tidak ada gambar di pin ini');

  // Konstruksi semua ukuran dari CDN pattern Pinterest
  // https://i.pinimg.com/236x/aa/bb/cc/hash.jpg → ganti size prefix
  const sizes = ['originals', '736x', '564x', '474x', '236x'];
  const media: PinterestResult['media'] = sizes
    .map((size) => ({
      type: 'image' as const,
      url: thumbnail.replace(/\/\d+x\/|\/originals\//, `/${size}/`),
      quality: size,
    }))
    .filter((m, i, arr) => arr.findIndex((x) => x.url === m.url) === i); // dedup

  return {
    id: pinId,
    title: data.title || null,
    description: null,
    author: {
      name: data.author_name ?? '',
      username: data.author_url?.split('/').filter(Boolean).pop() ?? '',
    },
    board: null,
    thumbnail,
    media,
  };
}

export async function downloadPinterest(url: string): Promise<PinterestResult> {
  const { pinId, canonical } = await resolveUrl(url);

  // Coba yt-dlp dulu (video pin)
  try {
    const info = await ytdlpGetInfo(canonical);
    if (info.media.length > 0) {
      return {
        id: pinId,
        title: info.title !== 'Untitled' ? info.title : null,
        description: null,
        author: info.author,
        board: null,
        thumbnail: info.thumbnail,
        media: info.media.filter((m): m is typeof m & { type: 'image' | 'video' } => m.type === 'image' || m.type === 'video'),
      };
    }
  } catch (err: any) {
    // Kalau bukan video pin, fallback ke scraping
    const isImagePin = /no video formats found/i.test(err.message ?? '');
    if (!isImagePin) throw err;
  }

  // Fallback: image pin via scraping HTML
  return scrapeImagePin(pinId);
}