/** System fonts need no FontFace object; the bundled Hebrew face must be present. */
export async function ensureNameFont(style, size) {
  const fonts = globalThis.document?.fonts;
  if (!fonts?.load) throw new Error(`Name rendering requires ${style.fontFamily}`);
  await fonts.ready;
  const faces = await fonts.load(`${size}px ${style.canvasFontStack}`);
  if (style.fontFamily === 'Guttman Hatzvi' && (!Array.isArray(faces) || !faces.some(face =>
    face.family?.replaceAll('"', '').replaceAll("'", '').trim() === 'Guttman Hatzvi' && face.status === 'loaded'))) {
    throw new Error('Name rendering requires Guttman Hatzvi');
  }
  const loaded = (faces || []).map(face => `${face.family}:${face.style || ''}:${face.weight || ''}:${face.status || ''}`).sort();
  return { fontIdentity: JSON.stringify([style.language, style.direction, style.canvasFontStack, loaded]) };
}
