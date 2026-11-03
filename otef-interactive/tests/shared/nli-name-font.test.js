import { expect, test, vi } from 'vitest';
import { ensureNameFont } from '../../frontend/src/shared/nli-name-font.js';
import { nameTextStyle } from '../../frontend/src/shared/nli-name-language.js';

test('selected Hadassah requires its exact loaded content face', async () => {
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve(), load: async () => [] } });
  try {
    await expect(ensureNameFont({ fontFamily: 'NLI Content Hadassah Friedlaender',
      canvasFontStack: '"NLI Content Hadassah Friedlaender", sans-serif', language: 'en', direction: 'ltr' }, 12))
      .rejects.toThrow(/NLI Content Hadassah Friedlaender/);
  } finally { vi.unstubAllGlobals(); }
});

test('matching loaded content alias resolves and participates in identity', async () => {
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve(), load: async () => [
    { family: 'NLI Content Hadassah Friedlaender', status: 'loaded' },
  ] } });
  try {
    const result = await ensureNameFont({ fontFamily: 'NLI Content Hadassah Friedlaender',
      canvasFontStack: '"NLI Content Hadassah Friedlaender", sans-serif', language: 'en', direction: 'ltr' }, 12);
    expect(result.fontIdentity).toContain('NLI Content Hadassah Friedlaender');
  } finally { vi.unstubAllGlobals(); }
});

test('Hebrew baseline keeps Guttman readiness and system Arial is not tablet-ready', async () => {
  let guttmanLoaded = true;
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve(), load: async stack => stack.includes('Guttman') && guttmanLoaded
    ? [{ family: 'Guttman Hatzvi', status: 'loaded' }] : [] } });
  try {
    expect((await ensureNameFont(nameTextStyle('he'), 12)).fontIdentity).toContain('Guttman Hatzvi');
    guttmanLoaded = false;
    await expect(ensureNameFont(nameTextStyle('he'), 12)).rejects.toThrow(/Guttman/);
    await expect(ensureNameFont({ fontFamily: 'NLI Content Arial', canvasFontStack: '"NLI Content Arial", sans-serif',
      language: 'en', direction: 'ltr' }, 12)).rejects.toThrow(/NLI Content Arial/);
  } finally { vi.unstubAllGlobals(); }
});
