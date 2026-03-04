const CURATED_LAYER_PALETTE = Object.freeze([
  "#00b4d8", "#2dc653", "#e9c46a", "#e76f51", "#9b59b6", "#1dd3b0",
]);

function getCuratedColor(fullLayerId) {
  let h = 0;
  for (let i = 0; i < fullLayerId.length; i++)
    h = (h << 5) - h + fullLayerId.charCodeAt(i);
  return CURATED_LAYER_PALETTE[Math.abs(h) % CURATED_LAYER_PALETTE.length];
}

export const UI_CONFIG = Object.freeze({
  curatedPalette: CURATED_LAYER_PALETTE,
  getCuratedColor,
  legend: Object.freeze({
    fallbackLandUseField: "KVUZ_TRG",
    fallbackScheme: "category10",
  }),
});
