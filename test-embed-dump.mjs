const shortcode = process.argv[2];
if (!shortcode) { console.error('Usage: node test-embed-dump.mjs SHORTCODE'); process.exit(1); }

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const res = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
  headers: { 'User-Agent': UA_MOBILE, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
});

const html = await res.text();

// Cari semua key JSON yang mungkin berisi metadata
const patterns = {
  'owner':        html.match(/"owner"\s*:\s*\{[^}]{0,200}/),
  'author_name':  html.match(/"author_name"\s*:\s*"([^"]+)"/),
  'author':       html.match(/"author"\s*:\s*"([^"]+)"/),
  'user':         html.match(/"user"\s*:\s*\{[^}]{0,200}/),
  'ProfilePage':  html.match(/ProfilePage[^,]{0,200}/),
  'display_name': html.match(/"display_name"\s*:\s*"([^"]+)"/),
  'og:title':     html.match(/og:title[^>]{0,100}/),
  'title tag':    html.match(/<title>([^<]+)<\/title>/),
};

for (const [key, match] of Object.entries(patterns)) {
  console.log(`${key}:`, match?.[0]?.slice(0, 150) ?? 'NOT FOUND');
}

// Print first 2000 chars untuk lihat struktur
console.log('\n--- FIRST 2000 chars ---');
console.log(html.slice(0, 2000));
