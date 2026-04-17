/**
 * Published curated layers list: load, render, unpublish, submission click-through.
 */

import { sanitizeCssColor } from "./curation-color-utils.js";
import { chipClassForTag, getSubmissionTagLabels } from "./curation-submissions.js";

export function extractSubmissionIdsFromLayerData(layerData) {
  const ids = new Set();
  const features = layerData && Array.isArray(layerData.features) ? layerData.features : [];
  features.forEach((feature) => {
    const props = feature && feature.properties ? feature.properties : {};
    const sid = props.submission_id ?? props.submissionId ?? null;
    if (sid != null && String(sid).trim() !== "") {
      ids.add(String(sid).trim().toLowerCase());
    }
  });
  return Array.from(ids);
}

const COLOR_PROP_KEYS = [
  "stroke",
  "color",
  "line_color",
  "lineColor",
  "map_color",
  "mapColor",
  "submission_color",
  "submissionColor",
  "display_color",
  "displayColor",
  "fill",
];

/**
 * GISLayer API records may store GeoJSON in `data`, sometimes `geojson`, or as a JSON string.
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
export function normalizeGisLayerGeojsonInput(raw) {
  if (raw == null) return null;
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (typeof v !== "object" || v === null) return null;
  return /** @type {Record<string, unknown>} */ (v);
}

/**
 * @param {Record<string, unknown> | null | undefined} activeLayer
 * @returns {Record<string, unknown> | null}
 */
export function getGeojsonDataFromGisLayerRecord(activeLayer) {
  if (!activeLayer || typeof activeLayer !== "object") return null;
  const blob = activeLayer.data ?? activeLayer.geojson;
  return normalizeGisLayerGeojsonInput(blob);
}

/**
 * True when merged type labels clearly match submission list semantics
 * (mixed / multiple / memorial / tkuma-axis line), so getSubmissionTagLabels is safe.
 * @param {string} merged
 */
function submissionTypeLabelMergedIsRecognized(merged) {
  const t = String(merged || "").trim().toLowerCase();
  if (!t) return false;
  if (t.includes("mixed") || t.includes("multiple")) return true;
  if (t.includes("memorial")) return true;
  if (t.includes("tkuma") || t.includes("moreshet")) return true;
  if (t.includes("axis") || t.includes("route")) return true;
  if (/\bline\b/.test(t)) return true;
  return false;
}

/**
 * @param {unknown} layerData GeoJSON-like { features?: unknown[] }
 * @returns {string | null} best-effort CSS color string for UI
 */
export function extractColorFromGeojsonData(layerData) {
  const features = layerData && Array.isArray(layerData.features) ? layerData.features : [];
  for (let i = 0; i < features.length && i < 80; i++) {
    const f = features[i];
    const p = f && typeof f === "object" && f.properties ? f.properties : {};
    for (const k of COLOR_PROP_KEYS) {
      const v = p[k];
      if (v == null) continue;
      const s = String(v).trim();
      if (!s) continue;
      if (sanitizeCssColor(s)) return s;
    }
  }
  return null;
}

/**
 * @param {unknown} layerData
 * @returns {string[]} Line / Memorials style labels (reuses submission tag rules when type_label exists)
 */
export function extractInfoTagsFromGeojsonData(layerData) {
  const features = layerData && Array.isArray(layerData.features) ? layerData.features : [];
  if (features.length === 0) return [];

  const typeLabels = new Set();
  let sawLine = false;
  let sawPoint = false;
  for (let i = 0; i < features.length && i < 80; i++) {
    const f = features[i];
    const p = f && typeof f === "object" && f.properties ? f.properties : {};
    const tl = p.type_label ?? p.typeLabel ?? p.submission_type ?? p.feature_type;
    if (tl != null && String(tl).trim() !== "") {
      typeLabels.add(String(tl).trim());
    }
    const g = f && f.geometry && f.geometry.type ? String(f.geometry.type) : "";
    if (g === "LineString" || g === "MultiLineString") sawLine = true;
    if (g === "Point" || g === "MultiPoint") sawPoint = true;
    const cat = String(p.category || p.kind || "").toLowerCase();
    if (cat.includes("memorial")) typeLabels.add("Memorials");
    if (cat.includes("line") || cat.includes("axis") || cat.includes("route")) typeLabels.add("Tkuma Line");
  }

  if (typeLabels.size > 0) {
    const merged = Array.from(typeLabels).join(" / ");
    if (submissionTypeLabelMergedIsRecognized(merged)) {
      return getSubmissionTagLabels({ typeLabel: merged });
    }
  }

  const fallback = [];
  if (sawLine) fallback.push("Tkuma Line");
  if (sawPoint) fallback.push("Memorials");
  return fallback;
}

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function formatUpdatedAtForUi(iso) {
  if (iso == null || String(iso).trim() === "") return "—";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} activeLayer
 */
export function derivePublishedLayerUiFields(activeLayer) {
  const data = getGeojsonDataFromGisLayerRecord(activeLayer);
  const updatedRaw =
    activeLayer && (activeLayer.updated_at ?? activeLayer.updatedAt ?? activeLayer.modified_at);
  return {
    updatedAtLabel: formatUpdatedAtForUi(updatedRaw != null ? String(updatedRaw) : ""),
    colorRaw: extractColorFromGeojsonData(data),
    infoTags: extractInfoTagsFromGeojsonData(data),
  };
}

/**
 * @param {object} deps
 * @param {ReturnType<import("./curation-api.js").createCurationApi>} deps.API
 * @param {() => HTMLElement | null} deps.publishedLayersContainer
 * @param {(s: string) => string} deps.escapeHtml
 * @param {(msg: string, type?: string) => void} deps.setStatus
 * @param {{ current: Array<{ fullLayerId: string; displayName: string; submissionId: string; updatedAtLabel: string; colorRaw: string | null; infoTags: string[] }> }} deps.publishedCuratedLayersRef
 * @param {{ current: string | null }} deps.lastPublishedFullLayerIdRef
 * @param {(submissionId: string) => void} deps.selectSubmissionById
 * @param {(submissionId: string) => boolean} deps.submissionExists
 * @param {(submissionId: string) => string} [deps.getSubmissionDisplayName]
 * @param {(submissionId: string) => string | null} [deps.getSubmissionColorCss]
 * @param {(displayName: string) => string | null} [deps.resolveSubmissionIdByDisplayName] when GeoJSON lacks submission_id, match card title to submission row name
 */
export function createPublishedCuratedLayersPanel(deps) {
  const {
    API,
    publishedLayersContainer,
    escapeHtml,
    setStatus,
    publishedCuratedLayersRef,
    lastPublishedFullLayerIdRef,
    selectSubmissionById,
    submissionExists,
    getSubmissionDisplayName = () => "",
    getSubmissionColorCss = () => null,
    resolveSubmissionIdByDisplayName,
  } = deps;

  function renderTagChips(tags) {
    const list = Array.isArray(tags) ? tags : [];
    if (list.length === 0) return "";
    return list
      .map((tag) => {
        const cls = chipClassForTag(tag);
        return `<span class="${cls}">${escapeHtml(tag)}</span>`;
      })
      .join("");
  }

  function renderPublishedCuratedLayers() {
    const container = publishedLayersContainer();
    if (!container) return;
    const publishedCuratedLayers = publishedCuratedLayersRef.current;
    if (!Array.isArray(publishedCuratedLayers) || publishedCuratedLayers.length === 0) {
      container.innerHTML = '<div class="curation-status">No published curated layers.</div>';
      return;
    }
    container.innerHTML = publishedCuratedLayers
      .map((layer) => {
        const fullLayerId = String(layer.fullLayerId || "");
        const displayName = String(layer.displayName || fullLayerId);
        const sidFromGeo = String(layer.submissionId || "").trim().toLowerCase();
        const sidFromTitle = String(
          resolveSubmissionIdByDisplayName?.(displayName) || "",
        ).trim().toLowerCase();
        const submissionId = sidFromGeo || sidFromTitle;
        const updatedAtLabel = String(layer.updatedAtLabel || "—");
        const colorRaw = layer.colorRaw != null ? String(layer.colorRaw) : "";
        const geoColor = sanitizeCssColor(colorRaw);
        const listColor =
          submissionId && getSubmissionColorCss ? getSubmissionColorCss(submissionId) : null;
        // Prefer Supabase submission list color (submission_batches.display_color); GeoJSON may omit stroke.
        const safeColor = listColor ?? geoColor ?? null;
        const swatch =
          safeColor != null
            ? `<span class="curation-published-layer-color" title="Submission color"><span class="curation-published-layer-swatch" style="background-color:${escapeHtml(safeColor)}"></span></span>`
            : "";
        const chips = renderTagChips(layer.infoTags);
        const subName = submissionId ? String(getSubmissionDisplayName(submissionId) || "").trim() : "";
        const openLabel = submissionId
          ? subName
            ? `Open submission ${subName} for published layer ${displayName}`
            : `Open submission for published layer ${displayName}`
          : `Published layer ${displayName}: submission unavailable (multiple or unknown); activates status message`;
        return `
          <div class="curation-published-layer-card" data-full-layer-id="${escapeHtml(fullLayerId)}">
            <div class="curation-published-layer-body">
              <button type="button" class="curation-published-layer-main curation-published-layer-select" data-submission-id="${escapeHtml(submissionId)}" aria-label="${escapeHtml(openLabel)}">
                <div class="curation-published-layer-name">${escapeHtml(displayName)}</div>
                <div class="curation-published-layer-meta-row">
                  <span class="curation-published-layer-updated" title="Layer last updated">${escapeHtml(updatedAtLabel)}</span>
                  ${swatch}
                </div>
                <div class="curation-published-layer-tags" aria-label="Layer type tags">${chips}</div>
              </button>
              <button type="button" class="curation-header-btn curation-published-layer-remove curation-unpublish-btn" data-full-layer-id="${escapeHtml(fullLayerId)}" aria-label="Remove layer from remote">Remove</button>
            </div>
          </div>`;
      })
      .join("");

    container.querySelectorAll(".curation-published-layer-select").forEach((openBtn) => {
      openBtn.addEventListener("click", () => {
        const sid = String(openBtn.getAttribute("data-submission-id") || "")
          .trim()
          .toLowerCase();
        if (!sid) {
          setStatus("This published layer maps to multiple/unknown submissions.", "error");
          return;
        }
        if (!submissionExists(sid)) {
          setStatus(`Submission ${sid} is not available in the submissions list.`, "error");
          return;
        }
        selectSubmissionById(sid);
      });
    });

    container.querySelectorAll(".curation-unpublish-btn").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const fullLayerId = String(btn.getAttribute("data-full-layer-id") || "");
        if (!fullLayerId) return;
        const ok =
          typeof window === "undefined" || !window.confirm
            ? true
            : window.confirm(`Remove "${fullLayerId}" from published remote layers?`);
        if (!ok) return;
        btn.disabled = true;
        try {
          await API.unpublishCuratedLayer({
            table: "otef",
            full_layer_id: fullLayerId,
          });
          if (lastPublishedFullLayerIdRef.current === fullLayerId) {
            lastPublishedFullLayerIdRef.current = null;
          }
          setStatus(`Removed "${fullLayerId}" from published remote layers.`, "success");
          await loadPublishedCuratedLayers();
        } catch (err) {
          setStatus("Could not remove published layer: " + (err?.message || String(err)), "error");
          btn.disabled = false;
        }
      });
    });
  }

  async function loadPublishedCuratedLayers() {
    const container = publishedLayersContainer();
    if (!container) return;
    container.innerHTML = '<div class="curation-status">Loading published curated layers…</div>';
    try {
      const state = await API.layerGroups("otef");
      const activeLayers = await API.activeGisLayers("otef");
      const activeById = new Map(activeLayers.map((layer) => [String(layer.id), layer]));
      const layerGroups = Array.isArray(state?.layerGroups) ? state.layerGroups : [];
      const curatedGroup = layerGroups.find((g) => g && g.id === "curated_moresht_axis");
      const primary = (curatedGroup?.layers || [])
        .filter((layer) => layer && activeById.has(String(layer.id)))
        .map((layer) => {
          const source = activeById.get(String(layer.id));
          const geo = source ? getGeojsonDataFromGisLayerRecord(source) : null;
          const ids = extractSubmissionIdsFromLayerData(geo);
          const ui = derivePublishedLayerUiFields(source);
          return {
            fullLayerId: `curated_moresht_axis.${String(layer.id)}`,
            displayName: layer.displayName || String(layer.id),
            submissionId: ids.length === 1 ? ids[0] : "",
            ...ui,
          };
        });
      if (primary.length > 0) {
        publishedCuratedLayersRef.current = primary;
        renderPublishedCuratedLayers();
        return;
      }

      // Fallback: some environments still expose active curated layers without
      // full curated group state, so load from active GIS layers.
      publishedCuratedLayersRef.current = activeLayers
        .filter((layer) => {
          const layerName = String(layer?.name || "");
          return layerName.startsWith("curated_");
        })
        .map((layer) => {
          const geo = getGeojsonDataFromGisLayerRecord(layer);
          const ids = extractSubmissionIdsFromLayerData(geo);
          const ui = derivePublishedLayerUiFields(layer);
          return {
            fullLayerId: `curated_moresht_axis.${String(layer.id)}`,
            displayName: String(layer.display_name || layer.name || layer.id),
            submissionId: ids.length === 1 ? ids[0] : "",
            ...ui,
          };
        });
      renderPublishedCuratedLayers();
    } catch (err) {
      publishedCuratedLayersRef.current = [];
      container.innerHTML = `<div class="curation-status error">Could not load published curated layers: ${escapeHtml(err?.message || String(err))}</div>`;
    }
  }

  return { loadPublishedCuratedLayers, renderPublishedCuratedLayers };
}
