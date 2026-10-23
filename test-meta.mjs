const shortcode = process.argv[2];
if (!shortcode) { console.error('Usage: node test-meta.mjs SHORTCODE'); process.exit(1); }

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

console.log('=== Testing EMBED ===');
try {
  const res = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
    headers: { 'User-Agent': UA_MOBILE, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
  });
  console.log('Status:', res.status);
  const html = await res.text();
  console.log('HTML length:', html.length);
  console.log('username match:', html.match(/"username"\s*:\s*"([^"]+)"/)?.[1]);
  console.log('full_name match:', html.match(/"full_name"\s*:\s*"([^"]+)"/)?.[1]);
  console.log('text match:', html.match(/"text"\s*:\s*"((?:[^"\\]|\\.){0,100})"/)?.[1]);
  console.log('og:title match:', html.match(/property="og:title"\s+content="([^"]+)"/)?.[1]);
  // Print snippet around "username" if exists
  const idx = html.indexOf('"username"');
  if (idx > -1) console.log('snippet:', html.slice(idx, idx+100));
  else console.log('WARNING: "username" not found in embed HTML');
} catch(e) { console.error('EMBED ERROR:', e.message); }

console.log('\n=== Testing GRAPHQL ===');
try {
  const variables = JSON.stringify({ shortcode });
  const url = `https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables=${encodeURIComponent(variables)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA_MOBILE, Accept: '*/*', 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' }
  });
  console.log('Status:', res.status);
  const ct = res.headers.get('content-type');
  console.log('Content-Type:', ct);
  if (ct?.includes('json')) {
    const json = await res.json();
    const item = json?.data?.shortcode_media;
    console.log('shortcode_media exists:', !!item);
    if (item) {
      console.log('username:', item.owner?.username);
      console.log('full_name:', item.owner?.full_name);
      console.log('caption:', item.edge_media_to_caption?.edges?.[0]?.node?.text?.slice(0,100));
    } else {
      console.log('Response keys:', Object.keys(json));
    }
  } else {
    const text = await res.text();
    console.log('Non-JSON response (first 200):', text.slice(0,200));
  }
} catch(e) { console.error('GRAPHQL ERROR:', e.message); }
