import { SUBMISSION_DISPLAY_COLOR_PALETTE } from "../map-utils/submission-display-color.js";

const CURATED_LAYER_PALETTE = Object.freeze([
  "#00b4d8", "#2dc653", "#e9c46a", "#e76f51", "#9b59b6", "#1dd3b0",
]);

function normalizeCuratedProposalKey(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .trim()
    .replace(/\s*[-:]?\s*\(?(?:rev(?:ision)?|v)\s*#?\d+\)?\s*$/i, "")
    .trim()
    .toLowerCase();
}

export function getCuratedColorKey(fullLayerId, layerData) {
  const styleConfig = layerData && layerData.style_config ? layerData.style_config : null;
  if (styleConfig && typeof styleConfig.color_seed === "string" && styleConfig.color_seed.trim()) {
    return styleConfig.color_seed.trim();
  }

  const displayName = layerData && typeof layerData.display_name === "string"
    ? layerData.display_name
    : "";
  const normalizedDisplayName = normalizeCuratedProposalKey(displayName);
  if (normalizedDisplayName) {
    return normalizedDisplayName;
  }
  return fullLayerId || "";
}

function getCuratedColor(fullLayerId, layerData) {
  const key = getCuratedColorKey(fullLayerId, layerData);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h << 5) - h + key.charCodeAt(i);
  return CURATED_LAYER_PALETTE[Math.abs(h) % CURATED_LAYER_PALETTE.length];
}

/**
 * Same key + hash as `getCuratedColor`, but indexes the submission display palette so
 * dual-dash proposed line styles stay on the allowlisted primary set.
 *
 * @param {string} fullLayerId
 * @param {object | null | undefined} layerData
 * @returns {string} Uppercase `#RRGGBB`
 */
function getSubmissionDisplayPrimaryForCuratedLayer(fullLayerId, layerData) {
  const key = getCuratedColorKey(fullLayerId, layerData);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h << 5) - h + key.charCodeAt(i);
  return SUBMISSION_DISPLAY_COLOR_PALETTE[Math.abs(h) % SUBMISSION_DISPLAY_COLOR_PALETTE.length];
}

export const UI_CONFIG = Object.freeze({
  curatedPalette: CURATED_LAYER_PALETTE,
  getCuratedColor,
  getCuratedColorKey,
  getSubmissionDisplayPrimaryForCuratedLayer,
  legend: Object.freeze({
    fallbackLandUseField: "KVUZ_TRG",
    fallbackScheme: "category10",
  }),
});
