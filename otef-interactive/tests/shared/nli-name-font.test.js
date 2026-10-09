import { expect, test, vi } from 'vitest';
import { ensureNameFont } from '../../frontend/src/shared/nli-name-font.js';
import { nameTextStyle } from '../../frontend/src/shared/nli-name-language.js';

test('native Arial can be ready without FontFace objects while bundled Hebrew font must be loaded', async () => {
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve(), load: async () => [] } });
  try {
    expect((await ensureNameFont(nameTextStyle('en'), 12)).fontIdentity).toContain('Arial');
    expect((await ensureNameFont({ ...nameTextStyle('he'), fontFamily: 'Arial', canvasFontStack: 'Arial, sans-serif' }, 12)).fontIdentity).toContain('Arial');
    await expect(ensureNameFont(nameTextStyle('he'), 12)).rejects.toThrow(/Guttman/);
  } finally { vi.unstubAllGlobals(); }
});
