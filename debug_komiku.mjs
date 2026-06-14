// Jalankan: node debug_komiku.mjs
import fs from 'fs';

const BASE_URL = 'https://komiku.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function main() {
  const params = new URLSearchParams({ post_type: 'manga', s: 'one piece' });
  const url = `${BASE_URL}/?${params}`;
  console.log('Fetching:', url);

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    }
  });

  console.log('Status:', res.status);
  const html = await res.text();
  console.log('HTML length:', html.length);

  // Cari semua class yang relevan untuk card manga
  const classMatches = [...html.matchAll(/class="([^"]{2,80})"/g)]
    .map(m => m[1])
    .filter(c => c.match(/post|manga|comic|card|item|entry|bge|ls|grid|thumb|cover|title|result/i));

  const unique = [...new Set(classMatches)];
  console.log('\n=== Relevant classes found ===');
  unique.forEach(c => console.log(' -', c));

  // Cari semua heading
  const headings = [...html.matchAll(/<h\d[^>]*>([\s\S]{0,300}?)<\/h\d>/gi)].slice(0, 10);
  console.log('\n=== First headings ===');
  headings.forEach(([h]) => console.log(h.replace(/\s+/g, ' ').substring(0, 200)));

  // Cari semua link yang mengarah ke manga
  const links = [...html.matchAll(/<a[^>]+href="(https?:\/\/komiku\.org\/[^"]+)"[^>]*>/gi)]
    .map(m => m[1])
    .filter(u => !u.includes('category') && !u.includes('tag') && !u.includes('page'));
  console.log('\n=== Sample manga links ===');
  [...new Set(links)].slice(0, 10).forEach(l => console.log(' -', l));

  // Simpan HTML lengkap
  fs.writeFileSync('./komiku_search.html', html);
  console.log('\nHTML saved to ./komiku_search.html');
}

main().catch(console.error);
