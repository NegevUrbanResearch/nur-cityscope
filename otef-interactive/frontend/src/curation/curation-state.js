/**
 * Curation UI state: preview layer registry + submission type styling.
 */

/**
 * Lightweight, DOM-free controller for curation preview state.
 * This is exported for Jest tests and used by the runtime map code.
 */
export function createCurationPreviewState() {
  const featureLayers = new Map();
  const visibleFeatures = new Map();
  let highlightedFeatureId = null;

  function registerFeatureLayers(featureId, layers) {
    const key = String(featureId);
    featureLayers.set(key, Array.isArray(layers) ? [...layers] : []);
    if (!visibleFeatures.has(key)) {
      visibleFeatures.set(key, true);
    }
  }

  function setFeatureVisible(featureId, isVisible) {
    const key = String(featureId);
    if (!featureLayers.has(key)) return;
    visibleFeatures.set(key, Boolean(isVisible));
  }

  function getVisibleLayers() {
    const result = [];
    for (const [key, layers] of featureLayers.entries()) {
      if (visibleFeatures.get(key)) {
        result.push(...layers);
      }
    }
    return result;
  }

  function clearPreview() {
    featureLayers.clear();
    visibleFeatures.clear();
    highlightedFeatureId = null;
  }

  function highlightFeature(featureId) {
    if (featureId == null) {
      highlightedFeatureId = null;
    } else {
      highlightedFeatureId = String(featureId);
    }
  }

  return {
    featureLayers,
    visibleFeatures,
    getVisibleLayers,
    registerFeatureLayers,
    setFeatureVisible,
    clearPreview,
    highlightFeature,
    get highlightedFeatureId() {
      return highlightedFeatureId;
    },
  };
}

export const CURATION_HISTORY_FILTER_KEY = "curation_history_filter";

export function getSubmissionTypeClass(typeLabel) {
  const label = String(typeLabel || "").toLowerCase();
  if (label.includes("mixed") || label.includes("multiple")) return "type-multiple";
  if (label.includes("memorial")) return "type-memorial";
  return "type-moreshet";
}

export function getHistoryFilterState() {
  try {
    const raw = localStorage.getItem(CURATION_HISTORY_FILTER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed.showOldRevisions === "boolean") {
      return { showOldRevisions: parsed.showOldRevisions };
    }
    return {
      showOldRevisions:
        parsed?.showHistory === true && parsed?.showCurrent !== false,
    };
  } catch (_) {
    return { showOldRevisions: false };
  }
}

export function setHistoryFilterState(state) {
  const next = { showOldRevisions: state?.showOldRevisions === true };
  localStorage.setItem(CURATION_HISTORY_FILTER_KEY, JSON.stringify(next));
  return next;
}
