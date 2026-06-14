// node debug_komiku_api.mjs
import fs from 'fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchAndSave(label, url) {
  console.log(`\n=== ${label} ===`);
  console.log('URL:', url);

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
      'Referer': 'https://komiku.org/',
      'HX-Request': 'true',  // header htmx
    }
  });

  console.log('Status:', res.status);
  console.log('Content-Type:', res.headers.get('content-type'));

  const text = await res.text();
  console.log('Length:', text.length);
  console.log('Preview (500 chars):\n', text.substring(0, 500));

  fs.writeFileSync(`./komiku_api_${label}.html`, text);
  console.log(`Saved to ./komiku_api_${label}.html`);
}

// Search
await fetchAndSave('search', 'https://api.komiku.org/?post_type=manga&s=one+piece');

// Latest
await fetchAndSave('latest', 'https://api.komiku.org/');

// Popular
await fetchAndSave('popular', 'https://api.komiku.org/other/hot/');
