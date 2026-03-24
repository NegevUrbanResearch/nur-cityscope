/**
 * Curation UI state: preview layer registry + submission naming / type labels.
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

export const SUBMISSION_NAMES_KEY = "curation_submission_names";
export const CURATION_HISTORY_FILTER_KEY = "curation_history_filter";

export function getSubmissionNames() {
  try {
    const raw = localStorage.getItem(SUBMISSION_NAMES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

export function setSubmissionName(submissionId, name) {
  const names = getSubmissionNames();
  if (name != null && String(name).trim() !== "") {
    names[submissionId] = String(name).trim();
  } else {
    delete names[submissionId];
  }
  localStorage.setItem(SUBMISSION_NAMES_KEY, JSON.stringify(names));
}

export function getSubmissionDisplayName(submissionKey) {
  const names = getSubmissionNames();
  const custom = names[submissionKey];
  if (custom != null && String(custom).trim() !== "") return String(custom).trim();
  const idStr = String(submissionKey);
  return idStr.slice(0, 8) + (idStr.length > 8 ? "…" : "");
}

export function inferSubmissionTypeLabel(projectNames) {
  const names = Array.isArray(projectNames)
    ? Array.from(
        new Set(
          projectNames
            .map((v) => String(v || "").trim())
            .filter((v) => v.length > 0),
        ),
      )
    : [];
  if (names.length > 1) return "Multiple";
  const only = (names[0] || "").toLowerCase();
  if (
    only.includes("memorial") ||
    only.includes("הנצחה") ||
    only.includes("זיכרון")
  ) {
    return "Memorial";
  }
  return "Moreshet Axis";
}

export function getSubmissionTypeClass(typeLabel) {
  const label = String(typeLabel || "").toLowerCase();
  if (label === "multiple") return "type-multiple";
  if (label === "memorial") return "type-memorial";
  return "type-moreshet";
}

export function getHistoryFilterState() {
  try {
    const raw = localStorage.getItem(CURATION_HISTORY_FILTER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      showCurrent: parsed?.showCurrent !== false,
      showHistory: parsed?.showHistory === true,
    };
  } catch (_) {
    return { showCurrent: true, showHistory: false };
  }
}

export function setHistoryFilterState(state) {
  const next = {
    showCurrent: state?.showCurrent !== false,
    showHistory: state?.showHistory === true,
  };
  localStorage.setItem(CURATION_HISTORY_FILTER_KEY, JSON.stringify(next));
  return next;
}
