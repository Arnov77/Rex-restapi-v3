// node debug_mediafire.mjs <url>
// contoh: node debug_mediafire.mjs "https://www.mediafire.com/file/xxx/file.zip"
import fs from 'fs';

const url = process.argv[2];
if (!url) { console.error('Usage: node debug_mediafire.mjs <mediafire_url>'); process.exit(1); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const res = await fetch(url, {
  headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
  redirect: 'follow',
});

const html = await res.text();
fs.writeFileSync('./mediafire_page.html', html);
console.log('Status:', res.status);
console.log('Saved to ./mediafire_page.html');

// Cari semua teks yang mengandung angka tahun / tanggal
const datePatterns = [
  /\d{4}-\d{2}-\d{2}/g,
  /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/g,
  /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/gi,
  /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/gi,
  /"date[^"]*"\s*:\s*"([^"]+)"/gi,
  /"created[^"]*"\s*:\s*"?(\d+)"?/gi,
  /"modified[^"]*"\s*:\s*"?(\d+)"?/gi,
  /"upload[^"]*"\s*:\s*"([^"]+)"/gi,
  /uploaded[^<]{0,50}/gi,
];

console.log('\n=== DATE-RELATED CONTENT ===');
for (const pat of datePatterns) {
  const matches = [...html.matchAll(pat)];
  if (matches.length) {
    console.log(`\nPattern: ${pat}`);
    matches.slice(0, 5).forEach(m => console.log(' ', m[0].trim().substring(0, 150)));
  }
}
