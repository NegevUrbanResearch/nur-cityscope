/** Content aliases must resolve to their own same-origin webface before rendering. */
export async function ensureNameFont(style, size, document = globalThis.document) {
  const fonts = document?.fonts;
  if (!fonts?.load) throw new Error(`Name rendering requires ${style.fontFamily}`);
  await fonts.ready;
  const faces = await fonts.load(`${size}px ${style.canvasFontStack}`);
  const expectedFamily = style.fontFamily.startsWith('NLI Content ') ? style.fontFamily
    : style.fontFamily === 'Guttman Hatzvi' ? 'Guttman Hatzvi' : null;
  if (expectedFamily && (!Array.isArray(faces) || !faces.some(face =>
    face.family?.replaceAll('"', '').replaceAll("'", '').trim() === expectedFamily && face.status === 'loaded'))) {
    throw new Error(`Name rendering requires ${expectedFamily}`);
  }
  const loaded = (faces || []).map(face => `${face.family}:${face.style || ''}:${face.weight || ''}:${face.status || ''}`).sort();
  return { fontIdentity: JSON.stringify([style.language, style.direction, style.canvasFontStack, loaded]) };
}
