import './setupEnv.js';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';

vi.mock('../src/shared/utils/ssrfGuard.js', () => ({
  assertPublicUrl: vi.fn(async () => new URL('https://cdn.example.com/x.jpg')),
}));

const { smemeService } = await import('../src/modules/makers/smeme/smeme.service.js');
const { SmemeQuery } = await import('../src/modules/makers/smeme/smeme.schemas.js');

async function testImage(w = 400, h = 300): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 40, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

describe('smeme.service (canvas, tanpa chromium)', () => {
  it('render gambar upload + top/bottom jadi jpeg', async () => {
    const input = await testImage();
    const query = SmemeQuery.parse({ top: 'halo', bottom: 'dunia', quality: 90 });
    const result = await smemeService.generate(query, { inputBuffer: input, inputMime: 'image/png' });
    expect(result.format).toBe('jpeg');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.buffer.length).toBeGreaterThan(1000);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
    expect(meta.format).toBe('jpeg');
  });

  it('teks panjang tetap muat (wrap + shrink)', async () => {
    const input = await testImage(300, 300);
    const query = SmemeQuery.parse({
      top: 'ini kalimat yang sangat panjang sekali untuk menguji word wrap',
      quality: 90,
    });
    const result = await smemeService.generate(query, { inputBuffer: input, inputMime: 'image/png' });
    expect(result.format).toBe('jpeg');
    expect(result.buffer.length).toBeGreaterThan(1000);
  });

  it('gambar besar di-cap ke 1200px', async () => {
    const input = await testImage(2400, 1800);
    const query = SmemeQuery.parse({ top: 'gede', quality: 90 });
    const result = await smemeService.generate(query, { inputBuffer: input, inputMime: 'image/png' });
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(900);
  });

  it('jalur URL: HEAD detect + GET + cache', async () => {
    const input = await testImage(400, 300);
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(input);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const query = SmemeQuery.parse({ url: `http://127.0.0.1:${port}/x.png`, top: 'via url', quality: 90 });
      const r1 = await smemeService.generate(query);
      expect(r1.format).toBe('jpeg');
      const meta = await sharp(r1.buffer).metadata();
      expect(meta.width).toBe(400);
      expect(meta.height).toBe(300);
      const hitsAfterFirst = hits;
      const r2 = await smemeService.generate(query);
      expect(r2.buffer.equals(r1.buffer)).toBe(true);
      // request kedua: HEAD tetap jalan, tapi GET tidak (cache-hit)
      expect(hits).toBe(hitsAfterFirst + 1);
    } finally {
      server.close();
    }
  });

  it('teks dengan emoji tetap render jadi jpeg', async () => {
    const input = await testImage();
    const query = SmemeQuery.parse({ top: 'halo 😂', bottom: 'tes 😭🔥', quality: 90 });
    const result = await smemeService.generate(query, { inputBuffer: input, inputMime: 'image/png' });
    expect(result.format).toBe('jpeg');
    expect(result.buffer.length).toBeGreaterThan(1000);
  });

  it('schema tetap menolak tanpa top/bottom', () => {
    expect(() => SmemeQuery.parse({ quality: 90 })).toThrow();
  });
});
