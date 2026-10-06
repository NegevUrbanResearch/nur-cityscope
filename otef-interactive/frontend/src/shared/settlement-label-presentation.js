export const EXCLUDED_SETTLEMENT_CODES = new Set(['240P', '724P', '0338', '1223', '1231']);
// Unnamed Mavki'im polygon in the reviewed projector-base outline collection.
export const EXCLUDED_SETTLEMENT_OUTLINE_IDS = new Set(['41']);
export const SETTLEMENT_OUTLINE_DATA_REVISION = 'amioz-osm-82487628-v16';

// Matches the white stroke and muted outer stroke in Locations_Lines.
export const DEFAULT_SETTLEMENT_LEADER_STYLE = Object.freeze({
  widthPx: 1.5238095238095237,
  outlineWidthPx: 0.5714285714285714,
  color: '#fdfdfd',
  outlineColor: '#bfbf99',
  opacity: 1,
});

export function settlementTextLines(text, afterWord = 0) {
  const words = String(text).trim().split(/\s+/);
  return Number.isInteger(afterWord) && afterWord > 0 && afterWord < words.length
    ? [words.slice(0, afterWord).join(' '), words.slice(afterWord).join(' ')]
    : [String(text)];
}
