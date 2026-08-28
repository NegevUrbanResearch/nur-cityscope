/**
 * Workshop (curated_moresht_axis) layer-tile swatch colors from submission metadata.
 */

import { sanitizeCssColor } from "../curation/curation-color-utils.js";
import { createCurationApi } from "../curation/curation-api.js";

const workshopSubmissionColorById = new Map();
const workshopSubmissionColorByName = new Map();
let workshopSubmissionColorsLoaded = false;
let workshopSubmissionColorsLoading = null;

function normSubmissionKey(v) {
  return String(v ?? "").trim().toLowerCase();
}

export async function ensureWorkshopSubmissionColorsLoaded() {
  if (workshopSubmissionColorsLoaded) return;
  if (workshopSubmissionColorsLoading) {
    await workshopSubmissionColorsLoading;
    return;
  }
  workshopSubmissionColorsLoading = (async () => {
    try {
      const API = createCurationApi();
      const list = await API.submissionsAll();
      workshopSubmissionColorById.clear();
      workshopSubmissionColorByName.clear();
      for (const item of Array.isArray(list) ? list : []) {
        if (!item || typeof item !== "object") continue;
        const idKey = normSubmissionKey(item.id ?? item.submission_id);
        const nameKey = normSubmissionKey(item.name);
        const rawColor =
          item.submission_color ??
          item.submissionColor ??
          item.display_color ??
          item.displayColor ??
          item.color;
        const css = sanitizeCssColor(rawColor);
        if (!css) continue;
        if (idKey) workshopSubmissionColorById.set(idKey, css);
        if (nameKey) workshopSubmissionColorByName.set(nameKey, css);
      }
      workshopSubmissionColorsLoaded = true;
    } catch {
      // Keep empty maps on failure; layer tiles will still use direct metadata colors.
    } finally {
      workshopSubmissionColorsLoading = null;
    }
  })();
  await workshopSubmissionColorsLoading;
}

export function pickWorkshopRowSwatchCssColor(row, groupId) {
  if (!row || !Array.isArray(row.layers)) return null;
  const tryValue = (v) => {
    const css = sanitizeCssColor(v);
    return css || null;
  };
  for (const layer of row.layers) {
    if (!layer || typeof layer !== "object") continue;
    const direct =
      layer.submissionColor ??
      layer.displayColor ??
      layer.submission_color ??
      layer.display_color ??
      layer.color ??
      layer.fillColor ??
      layer.strokeColor;
    const fromDirect = tryValue(direct);
    if (fromDirect) return fromDirect;

    const style = layer.style;
    if (style && typeof style === "object") {
      for (const sk of ["fillColor", "color", "fill", "stroke"]) {
        const v = style[sk];
        if (typeof v !== "string") continue;
        const css = tryValue(v);
        if (css) return css;
      }
    }

    const meta = layer.metadata;
    if (meta && typeof meta === "object") {
      for (const mk of [
        "display_color",
        "submissionColor",
        "displayColor",
        "color",
        "primaryColor",
      ]) {
        const css = tryValue(meta[mk]);
        if (css) return css;
      }
    }

    const props = layer.properties;
    if (props && typeof props === "object") {
      const css = tryValue(props.display_color ?? props.displayColor);
      if (css) return css;
    }
  }

  const gid = String(groupId || "");
  if (gid !== "curated_moresht_axis") return null;
  for (const layer of row.layers) {
    if (!layer || typeof layer !== "object") continue;
    const idKey = normSubmissionKey(layer.submissionId ?? layer.submission_id ?? layer.id);
    if (idKey && workshopSubmissionColorById.has(idKey)) {
      return workshopSubmissionColorById.get(idKey) || null;
    }
    const nameCandidates = [layer.displayName, layer.name, row.displayLabel];
    for (const candidate of nameCandidates) {
      const nk = normSubmissionKey(candidate);
      if (!nk) continue;
      if (workshopSubmissionColorByName.has(nk)) {
        return workshopSubmissionColorByName.get(nk) || null;
      }
    }
  }
  return null;
}
