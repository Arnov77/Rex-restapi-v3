import { AppError } from '@shared/errors.js';
import { withSerpApi } from '@shared/serpapiRotator.js';

export interface PinterestSearchResult {
  id: string;
  title: string | null;
  image: string | null;
  thumbnail: string | null;
  board: string | null;
  username: string | null;
  source: string | null;
}

interface SerpApiImageResult {
  position?: number;
  title?: string;
  link?: string;
  source?: string;
  original?: string;
  thumbnail?: string;
  serpapi_link?: string;
}

interface SerpApiOrganicResult {
  position?: number;
  title?: string;
  link?: string;
  redirect_link?: string;
  source?: string;
  snippet?: string;
  favicon?: string;
  thumbnail?: string;
}

interface SerpApiResponse {
  error?: string;
  image_results?: SerpApiImageResult[];
  inline_images?: SerpApiImageResult[];
  organic_results?: SerpApiOrganicResult[];
}

interface PinterestOEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

interface PinterestUrlMeta {
  id: string | null;
  username: string | null;
  board: string | null;
  canonical: string | null;
}

const ENGINES = ['google', 'google_images', 'google_images_light'];
const QUERY_TEMPLATES = [
  (query: string) => `${query} site:pinterest.com`,
  (query: string) => `${query} site:id.pinterest.com`,
  (query: string) => `pinterest ${query}`,
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function cleanText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text || null;
}

function upgradePinimgUrl(
  url: string | null | undefined,
  size: '236x' | '474x' | '564x' | '736x' | 'originals' = '736x',
): string | null {
  if (!url) return null;
  if (!url.includes('i.pinimg.com')) return url;

  return url.replace(
    /https?:\/\/i\.pinimg\.com\/(originals|236x|474x|564x|736x|1200x|200x150)\//i,
    `https://i.pinimg.com/${size}/`,
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function slugToTitle(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const text = slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return text || null;
}

function normalizePinterestSource(link: string | null | undefined): string | null {
  if (!link) return null;

  try {
    const url = new URL(link);
    if (!url.hostname.includes('pinterest.')) return link;

    url.protocol = 'https:';
    url.hash = '';
    url.search = '';
    return url.toString();
  } catch {
    return link;
  }
}

function parsePinterestUrl(link: string | null | undefined, fallbackId: string): PinterestUrlMeta {
  const source = normalizePinterestSource(link);
  if (!source) {
    return { id: fallbackId, username: null, board: null, canonical: null };
  }

  try {
    const url = new URL(source);
    const parts = url.pathname.split('/').filter(Boolean);

    const pinIndex = parts.findIndex((part) => part.toLowerCase() === 'pin');
    if (pinIndex >= 0) {
      const pinPart = parts[pinIndex + 1] || '';
      const id = pinPart.match(/(\d{6,})/)?.[1] || fallbackId;
      return {
        id,
        username: null,
        board: null,
        canonical: id ? `https://${url.hostname}/pin/${id}/` : source,
      };
    }

    const username = parts[0] || null;
    const board = parts[1] ? slugToTitle(parts[1]) : null;

    return {
      id: fallbackId,
      username,
      board,
      canonical: source,
    };
  } catch {
    return { id: fallbackId, username: null, board: null, canonical: source };
  }
}

function usernameFromSerpSource(source: string | null | undefined): string | null {
  const match = source?.match(/Pinterest\s*[·|-]\s*(.+)$/i);
  return cleanText(match?.[1])?.replace(/^@/, '') || null;
}

function usernameFromAuthorUrl(authorUrl: string | null | undefined): string | null {
  if (!authorUrl) return null;
  try {
    const url = new URL(authorUrl);
    const [username] = url.pathname.split('/').filter(Boolean);
    return username || null;
  } catch {
    return null;
  }
}

function getPinterestLink(item: SerpApiImageResult): string | null {
  const link = item.link?.toLowerCase();
  const serpapiLink = item.serpapi_link?.toLowerCase();
  const original = item.original?.toLowerCase();
  const thumbnail = item.thumbnail?.toLowerCase();

  if (link?.includes('pinterest.')) return item.link!;
  if (serpapiLink?.includes('pinterest.')) return item.serpapi_link!;
  if (original?.includes('pinimg.com') || thumbnail?.includes('pinimg.com')) {
    return item.link || item.serpapi_link || item.original || null;
  }

  return item.link || item.serpapi_link || null;
}

async function fetchSerpApi(query: string, engine: string, apiKey: string): Promise<SerpApiResponse> {
  const params = new URLSearchParams({
    engine,
    q: query,
    api_key: apiKey,
    hl: 'en',
    gl: 'us',
    safe: 'active',
  });

  if (engine !== 'google') params.set('ijn', '0');

  const res = await fetch(`https://serpapi.com/search?${params}`);
  const data = (await res.json().catch(() => ({}))) as SerpApiResponse;

  if (!res.ok || data.error) {
    const message = data.error || `SerpAPI returned ${res.status}`;
    throw new AppError(res.ok ? 502 : res.status, 'SERPAPI_ERROR', message);
  }

  return data;
}

async function fetchPinterestOEmbed(source: string | null): Promise<PinterestOEmbed | null> {
  if (!source || !source.includes('pinterest.')) return null;

  try {
    const params = new URLSearchParams({ url: source });
    const res = await fetch(`https://www.pinterest.com/oembed.json?${params}`, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json,text/plain,*/*',
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as PinterestOEmbed | null;
  } catch {
    return null;
  }
}

function getMetaContent(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const alt = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i');
  const match = html.match(re) || html.match(alt);
  return match?.[1] ? decodeHtml(match[1]) : null;
}

async function fetchPinterestHtmlMeta(source: string | null): Promise<Partial<PinterestSearchResult> & { canonical?: string | null }> {
  if (!source || !source.includes('pinterest.')) return {};

  try {
    const res = await fetch(source, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) return {};
    const html = await res.text();
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1]
      || null;

    return {
      title: cleanText(getMetaContent(html, 'og:title')),
      image: cleanText(getMetaContent(html, 'og:image')),
      thumbnail: cleanText(getMetaContent(html, 'og:image')),
      canonical: normalizePinterestSource(canonical),
    };
  } catch {
    return {};
  }
}

async function enrichPinterestResult(item: PinterestSearchResult): Promise<PinterestSearchResult> {
  const source = normalizePinterestSource(item.source);
  const fallbackMeta = parsePinterestUrl(source, item.id);

  let result: PinterestSearchResult = {
    id: item.id || fallbackMeta.id || '0',
    title: item.title ?? null,
    image: item.image ?? null,
    thumbnail: item.thumbnail ?? null,
    board: item.board ?? fallbackMeta.board ?? null,
    username: item.username ?? fallbackMeta.username ?? null,
    source: fallbackMeta.canonical ?? source ?? null,
  };

  const oembed = await fetchPinterestOEmbed(result.source);
  if (oembed) {
    const authorUsername = usernameFromAuthorUrl(oembed.author_url);
    result = {
      ...result,
      title: result.title ?? cleanText(oembed.title),
      image: result.image ?? cleanText(oembed.thumbnail_url),
      thumbnail: result.thumbnail ?? cleanText(oembed.thumbnail_url),
      username: result.username ?? authorUsername ?? cleanText(oembed.author_name),
    };
  }

  if (!result.image || !result.thumbnail || !result.title) {
    const htmlMeta = await fetchPinterestHtmlMeta(result.source);
    const canonical = normalizePinterestSource(htmlMeta.canonical);
    const parsedCanonical = parsePinterestUrl(canonical || result.source, result.id);

    result = {
      ...result,
      id: result.id || parsedCanonical.id || '0',
      title: result.title ?? htmlMeta.title ?? null,
      image: result.image ?? htmlMeta.image ?? null,
      thumbnail: result.thumbnail ?? htmlMeta.thumbnail ?? null,
      board: result.board ?? parsedCanonical.board ?? null,
      username: result.username ?? parsedCanonical.username ?? null,
      source: canonical ?? result.source,
    };
  }

  const finalImage = upgradePinimgUrl(result.image, '736x');
  const finalThumbnail = upgradePinimgUrl(result.thumbnail ?? result.image, '236x');
  
  return {
    id: result.id || '0',
    title: result.title ?? null,
    image: finalImage,
    thumbnail: finalThumbnail,
    board: result.board ?? null,
    username: result.username ?? null,
    source: result.source ?? null,
  };
}

function mapImageResults(data: SerpApiResponse, limit: number): PinterestSearchResult[] {
  const seen = new Set<string>();

  return (data.image_results || [])
    .map((item, index): PinterestSearchResult | null => {
      const link = getPinterestLink(item);
      const image = item.original || item.thumbnail || null;
      if (!link && !image) return null;

      const uniqueKey = image || link!;
      if (seen.has(uniqueKey)) return null;
      seen.add(uniqueKey);

      const fallbackId = String(item.position ?? index + 1);
      const meta = parsePinterestUrl(link || image, fallbackId);

      return {
        id: meta.id || fallbackId,
        title: cleanText(item.title),
        image,
        thumbnail: item.thumbnail || item.original || null,
        board: meta.board ?? null,
        username: meta.username ?? usernameFromSerpSource(item.source) ?? null,
        source: meta.canonical || normalizePinterestSource(link || image) || null,
      };
    })
    .filter((item): item is PinterestSearchResult => Boolean(item))
    .slice(0, limit);
}

function mapOrganicResults(data: SerpApiResponse, limit: number): PinterestSearchResult[] {
  const seen = new Set<string>();

  return (data.organic_results || [])
    .map((item, index): PinterestSearchResult | null => {
      if (!item.link?.includes('pinterest.')) return null;

      const source = normalizePinterestSource(item.link);
      if (!source || seen.has(source)) return null;
      seen.add(source);

      const fallbackId = String(item.position ?? index + 1);
      const meta = parsePinterestUrl(source, fallbackId);

      return {
        id: meta.id || fallbackId,
        title: cleanText(item.title),
        image: item.thumbnail || null,
        thumbnail: item.thumbnail || null,
        board: meta.board ?? null,
        username: meta.username ?? usernameFromSerpSource(item.source) ?? null,
        source: meta.canonical || source,
      };
    })
    .filter((item): item is PinterestSearchResult => Boolean(item))
    .slice(0, limit);
}

function mapSerpApiResults(data: SerpApiResponse, limit: number): PinterestSearchResult[] {
  const imageResults = mapImageResults({
    ...data,
    image_results: [...(data.image_results || []), ...(data.inline_images || [])],
  }, limit);

  if (imageResults.length > 0) return imageResults;
  return mapOrganicResults(data, limit);
}

export async function searchPinterest(query: string, limit: number): Promise<PinterestSearchResult[]> {
  return withSerpApi(async (apiKey) => {
    for (const engine of ENGINES) {
      for (const createQuery of QUERY_TEMPLATES) {
        const serpQuery = createQuery(query);
        const data = await fetchSerpApi(serpQuery, engine, apiKey);
        const basicResults = mapSerpApiResults(data, limit);

        if (basicResults.length > 0) {
          const enriched = await Promise.all(
            basicResults.slice(0, limit * 2).map(enrichPinterestResult),
          );
        
          const filtered = enriched.filter((item) => {
            const image = item.image?.toLowerCase() || '';
            const thumbnail = item.thumbnail?.toLowerCase() || '';
        
            return (
              item.image &&
              !image.includes('/custom_covers/') &&
              !thumbnail.includes('/custom_covers/')
            );
          });
        
          if (filtered.length === 0) {
            throw new AppError(404, 'PINTEREST_NO_VALID_IMAGES', 'Tidak ada hasil gambar Pinterest yang valid');
          }
        
          return filtered.slice(0, limit);
        }
      }
    }

    throw new AppError(404, 'PINTEREST_NO_RESULTS', 'Tidak ada hasil untuk query ini');
  });
}
