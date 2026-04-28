const { googleTtsSchema } = require('../src/core/tools/tts/tts.schemas');

describe('googleTtsSchema', () => {
  it('accepts minimal valid input + applies defaults', () => {
    const { error, value } = googleTtsSchema.validate({ text: 'Halo' });
    expect(error).toBeUndefined();
    expect(value).toEqual({ text: 'Halo', lang: 'id', slow: false });
  });

  it('rejects empty text', () => {
    const { error } = googleTtsSchema.validate({ text: '' });
    expect(error).toBeDefined();
    expect(error.message).toMatch(/empty/i);
  });

  it('rejects oversize text', () => {
    const { error } = googleTtsSchema.validate({ text: 'a'.repeat(5001) });
    expect(error).toBeDefined();
    expect(error.message).toMatch(/5000/);
  });

  it('rejects malformed lang', () => {
    const { error } = googleTtsSchema.validate({ text: 'Halo', lang: '12345' });
    expect(error).toBeDefined();
  });

  it('accepts BCP-47 lang variants', () => {
    for (const lang of ['id', 'en', 'en-US', 'pt-BR', 'zh-Hans']) {
      const { error } = googleTtsSchema.validate({ text: 'x', lang });
      expect(error).toBeUndefined();
    }
  });

  it('accepts slow=true', () => {
    const { value } = googleTtsSchema.validate({ text: 'x', slow: true });
    expect(value.slow).toBe(true);
  });
});
