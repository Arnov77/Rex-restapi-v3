import { AppError } from '@shared/errors.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface MediafireResult {
  filename: string;
  size: string | null;
  mimetype: string | null;
  uploadedAt: string | null;
  downloadUrl: string;
}

// Map ekstensi → mime type (extend sesuai kebutuhan)
const MIME_MAP: Record<string, string> = {
  // Archive
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  // Document
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  // Video
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  webm: 'video/webm',
  // Audio
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  // Image
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  // App/Game
  apk: 'application/vnd.android.package-archive',
  exe: 'application/x-msdownload',
  dmg: 'application/x-apple-diskimage',
  iso: 'application/x-iso9660-image',
  jar: 'application/java-archive',
  // Minecraft
  mcpack: 'application/octet-stream',
  mcworld: 'application/octet-stream',
  mcaddon: 'application/octet-stream',
};

function mimeFromFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_MAP[ext] ?? null;
}

export async function downloadMediafire(url: string): Promise<MediafireResult> {
  const pageUrl = url.replace(/\/file\/view\//, '/file/').replace(/\/$/, '') + (url.includes('/file/') ? '' : '/');

  const res = await fetch(pageUrl, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new AppError(
      res.status === 404 ? 404 : 502,
      'MEDIAFIRE_FETCH_ERROR',
      res.status === 404 ? 'File tidak ditemukan atau sudah dihapus' : `Gagal mengambil halaman: ${res.status}`,
    );
  }

  const html = await res.text();

  if (/file\s*(?:not found|has been deleted|unavailable)/i.test(html)) {
    throw new AppError(404, 'MEDIAFIRE_NOT_FOUND', 'File tidak ditemukan atau sudah dihapus');
  }

  // ─── Download URL ─────────────────────────────────────────────────────────
  const dlMatch =
    html.match(/id="downloadButton"[^>]*href="([^"]+)"/i) ??
    html.match(/href="([^"]+)"[^>]*id="downloadButton"/i) ??
    html.match(/class="[^"]*popsok[^"]*"[^>]*href="([^"]+)"/i) ??
    html.match(/"download_link"\s*:\s*"([^"]+)"/i) ??
    html.match(/href="(https:\/\/download\d*\.mediafire\.com\/[^"]+)"/i);

  if (!dlMatch) {
    throw new AppError(502, 'MEDIAFIRE_NO_LINK', 'Gagal mengekstrak link download. File mungkin butuh login atau sudah dihapus.');
  }

  const downloadUrl = (dlMatch[1] ?? '').replace(/\\u002F/g, '/').replace(/\\/g, '');

  // ─── Filename — dari URL download (paling akurat, ada ekstensi lengkap) ──
  const filenameFromUrl = decodeURIComponent(downloadUrl.split('/').pop()?.split('?')[0] ?? '');

  const filenameMatch =
    html.match(/<div[^>]+class="[^"]*filename[^"]*"[^>]*>([^<]+)<\/div>/i) ??
    html.match(/"filename"\s*:\s*"([^"]+)"/i) ??
    html.match(/<title>([^|<]+)/i);

  const filenameFromHtml = filenameMatch
    ? (filenameMatch[1] ?? '').trim().replace(/\s*[-|]\s*MediaFire.*/i, '').trim()
    : null;

  // Prioritas: URL (ada ekstensi) > HTML
  const filename = filenameFromUrl || filenameFromHtml || 'file';

  // ─── Size ─────────────────────────────────────────────────────────────────
  const sizeMatch =
    html.match(/"filesize"\s*:\s*"([^"]+)"/i) ??
    html.match(/class="[^"]*fileinfo[^"]*"[^>]*>[\s\S]*?(\d[\d.,]+\s*(?:KB|MB|GB|TB))/i) ??
    html.match(/(\d[\d.,]+\s*(?:KB|MB|GB|TB))/i);
  const size = sizeMatch ? (sizeMatch[1] ?? '').trim() || null : null;

  // ─── Mime type — dari HTML dulu, fallback derive dari ekstensi filename ──
  const mimeMatch = html.match(/"content_type"\s*:\s*"([^"]+)"/i);
  const mimetype = (mimeMatch ? mimeMatch[1] : mimeFromFilename(filename)) ?? null;

  // ─── Upload date — dari <li>Uploaded: <span>YYYY-MM-DD HH:mm:ss</span></li> ──
  const dateMatch =
    html.match(/<li>Uploaded:\s*<span>([^<]+)<\/span>/i) ??
    html.match(/"created"\s*:\s*"([^"]+)"/i) ??
    html.match(/uploaded from[^<]+on\s+([A-Za-z]+ \d{1,2}, \d{4})/i);
  const uploadedAt = dateMatch ? (dateMatch[1] ?? '').trim() || null : null;

  return { filename, size, mimetype, uploadedAt, downloadUrl };
}
