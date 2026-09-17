/**
 * Emulate Canvas/Leaflet `lineDashOffset` for MapLibre, which has no per-layer dash phase.
 * Returns a new dasharray (same line-space period) shifted by `offsetPx` in screen pixels.
 * Ref: `pink-route-map-styles.js` — primary `proposedLine` uses `PROPOSED_DASH_OFFSET_PRIMARY` vs
 * un-offset `proposedSecondary` so the two do not line up to transparent-looking gaps.
 *
 * @param {number[]} baseParts - [draw, gap, draw, gap, ...] in px (no offset)
 * @param {number} offsetPx
 * @returns {number[]}
 */
export function maplibreLineDashWithLeafletOffset(baseParts, offsetPx) {
  if (!Array.isArray(baseParts) || baseParts.length < 2) return baseParts;
  if (!Number.isFinite(offsetPx) || offsetPx === 0) return baseParts;
  const T = baseParts.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(T) || T <= 0) return baseParts;
  const o0 = ((offsetPx % T) + T) % T;
  if (o0 === 0) return baseParts;

  /** @type {{ len: number; isDash: boolean }[]} */
  const onePeriod = [];
  for (let i = 0; i < baseParts.length; i++) {
    onePeriod.push({ len: baseParts[i], isDash: i % 2 === 0 });
  }

  // Tile the pattern so walking forward from the phased start always has enough
  // segments to extract one full period T (offset can land near the end of a period).
  const nRep = 5;
  /** @type {{ len: number; isDash: boolean }[]} */
  const flat = [];
  for (let r = 0; r < nRep; r++) {
    for (const seg of onePeriod) {
      flat.push({ ...seg });
    }
  }

  let idx = 0;
  let posInSeg = 0;
  let rem = o0;
  while (rem > 0 && idx < flat.length) {
    const s = flat[idx];
    const avail = s.len - posInSeg;
    if (rem >= avail) {
      rem -= avail;
      idx += 1;
      posInSeg = 0;
    } else {
      posInSeg += rem;
      rem = 0;
    }
  }

  const chunks = [];
  let need = T;
  let curIdx = idx;
  let inSeg = posInSeg;
  if (curIdx >= flat.length) {
    return baseParts;
  }
  let cur = flat[curIdx];
  let curIsDash = cur.isDash;
  let curRem = cur.len - inSeg;
  while (need > 0 && curIdx < flat.length) {
    const take = Math.min(need, curRem);
    chunks.push({ len: take, isDash: curIsDash });
    need -= take;
    curRem -= take;
    if (curRem <= 0) {
      curIdx += 1;
      if (curIdx >= flat.length) break;
      cur = flat[curIdx];
      curIsDash = cur.isDash;
      curRem = cur.len;
    }
  }

  if (chunks.length === 0) return baseParts;

  /** @type {{ len: number; isDash: boolean }[]} */
  const merged = [];
  for (const ch of chunks) {
    const last = merged[merged.length - 1];
    if (last && last.isDash === ch.isDash) last.len += ch.len;
    else merged.push({ len: ch.len, isDash: ch.isDash });
  }

  // MapLibre: alternating dash, gap, dash, gap, …; allow leading 0 for phase starting in a gap
  if (merged[0].isDash) {
    const out = [];
    for (const m of merged) out.push(m.len);
    if (out.length % 2 === 1) out.push(0);
    return out;
  }
  const out = [0];
  for (const m of merged) out.push(m.len);
  if (out.length % 2 === 1) out.push(0);
  return out;
}

/**
 * Leaflet/Canvas `dashArray` and `lineDashOffset` are in **screen pixels** along the stroke.
 * MapLibre `line-dasharray` is in **line-width** multiples (visually, dash length is
 * `dasharray[i] * lineWidth` in px). Convert px-intent to MapLibre by dividing by line width.
 *
 * @param {number} lineWidthPx
 * @param {number[]} dashPartsPx
 * @param {number | null} offsetPx
 * @returns {number[]}
 */
export function maplibreLineDashFromLeafletPx(lineWidthPx, dashPartsPx, offsetPx) {
  const w =
    Number.isFinite(lineWidthPx) && lineWidthPx > 0
      ? lineWidthPx
      : 1;
  const norm = dashPartsPx.map((p) => p / w);
  if (offsetPx == null || offsetPx === 0) return norm;
  if (!Number.isFinite(offsetPx)) return norm;
  return maplibreLineDashWithLeafletOffset(norm, offsetPx / w);
}
