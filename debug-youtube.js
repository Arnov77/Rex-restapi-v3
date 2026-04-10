/**
 * YouTube Scraper Debug Script
 * Tests different approaches to download YouTube content
 */

const { ytmp3, ytmp4 } = require('@vreden/youtube_scraper');
const ytSearch = require('yt-search');

async function testScrapers() {
  console.log('='.repeat(60));
  console.log('🧪 YouTube Scraper Diagnostic Tests');
  console.log('='.repeat(60));

  // Test 1: yt-search (library we have)
  console.log('\n📍 Test 1: Using yt-search library...');
  try {
    const results = await ytSearch('never gonna give you up');
    if (results && results.videos && results.videos.length > 0) {
      console.log('✅ yt-search SUCCESS');
      console.log(`   Found: ${results.videos[0].title}`);
      console.log(`   URL: ${results.videos[0].url}`);
      console.log(`   Description: Recommendation - Use direct YouTube URL instead of search`);
    } else {
      console.log('❌ yt-search returned no results');
    }
  } catch (err) {
    console.log('❌ yt-search error:', err.message);
  }

  // Test 2: Try with a direct URL
  console.log('\n📍 Test 2: Using @vreden/youtube_scraper with direct URL...');
  try {
    // Rick Roll YouTube ID: dQw4w9WgXcQ
    const urlResult = await ytmp3('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    if (urlResult && urlResult.status) {
      console.log('✅ ytmp3 with URL SUCCESS');
      console.log(`   Title: ${urlResult.metadata?.title}`);
    } else {
      console.log('❌ ytmp3 with URL failed - status:', urlResult?.status);
    }
  } catch (err) {
    console.log('❌ ytmp3 with URL error:', err.message);
  }

  // Test 3: Try different search query
  console.log('\n📍 Test 3: Using @vreden/youtube_scraper with search...');
  try {
    const searchResult = await ytmp3('rick roll');
    if (searchResult && searchResult.status) {
      console.log('✅ ytmp3 search SUCCESS');
      console.log(`   Title: ${searchResult.metadata?.title}`);
    } else {
      console.log('❌ ytmp3 search failed - status:', searchResult?.status);
    }
  } catch (err) {
    console.log('❌ ytmp3 search error:', err.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Recommendations:');
  console.log('='.repeat(60));
  console.log(`
1. ✅ Use direct YouTube URLs when possible
   - Instead of search queries, get URLs from yt-search first
   - This avoids scraper issues

2. ⚠️  Search queries may not work due to YouTube blocking
   - Scrapers have an uphill battle with YouTube
   - Direct URLs are more reliable

3. 🔄 Consider updating the scraper library:
   npm update @vreden/youtube_scraper

4. 📌 For production, recommend:
   - Get video URL first using yt-search
   - Then download using the URL directly
  `);
  console.log('='.repeat(60));
}

testScrapers().catch(console.error);
