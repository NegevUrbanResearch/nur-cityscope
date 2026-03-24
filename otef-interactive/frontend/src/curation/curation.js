import { getMemorialIconForFeature } from "../shared/curated-layer-service.js";
import {
  createCurationPreviewState,
  getSubmissionNames,
  setSubmissionName,
  getSubmissionDisplayName,
  getSubmissionTypeClass,
  getHistoryFilterState,
  setHistoryFilterState,
} from "./curation-state.js";
import { createCurationApi } from "./curation-api.js";
import { createPublishedCuratedLayersPanel } from "./curation-published-layers.js";
import { createLoadSubmissions } from "./curation-submissions.js";
import { createCurationMapPreview } from "./curation-map-preview.js";

export { createCurationPreviewState } from "./curation-state.js";

/**
 * Curation page: list Supabase projects/submissions, Leaflet preview with
 * pink line (הקו_הורוד) base route, submission features as dashed lines and
 * labeled points. Toggle features, name and publish as OTEF layer.
 * Uses API proxy only (no Supabase client on frontend).
 */

(function () {
  const API = createCurationApi();

  let currentFeatures = [];
  const featureEnabled = new Map();
  const previewState = createCurationPreviewState();
  const pendingGeometryEdits = new Map();
  const publishedCuratedLayersRef = { current: [] };
  const lastPublishedFullLayerIdRef = { current: null };
  const submissionTypeById = new Map();

  let mapCtl;

  const el = (id) => document.getElementById(id);
  const submissionSelect = () => el("curationSubmission");
  const featuresContainer = () => el("curationFeatures");
  const layerNameInput = () => el("curationLayerName");
  const publishBtn = () => el("curationPublish");
  const statusEl = () => el("curationStatus");
  const refreshBtn = () => el("curationRefresh");
  const saveEditsBtn = () => el("curationSaveEdits");
  const publishedLayersContainer = () => el("curationPublishedLayers");
  const submissionTypeBadge = () => el("curationSubmissionTypeBadge");
  const showCurrentCheckbox = () => el("curationShowCurrent");
  const showHistoryCheckbox = () => el("curationShowHistory");
  const CURATED_GROUP_NAME = "Moreshet Axis";
  let historyFilterState = getHistoryFilterState();

  function setStatus(msg, type) {
    const s = statusEl();
    if (!s) return;
    s.textContent = msg || "";
    s.className = "curation-status" + (type ? " " + type : "");
  }

  function updateSubmissionTypeBadge(submissionId) {
    const badge = submissionTypeBadge();
    if (!badge) return;
    const key = String(submissionId || "").trim();
    if (!key) {
      badge.textContent = "";
      badge.className = "curation-type-badge";
      return;
    }
    const typeLabel = submissionTypeById.get(key) || "Moreshet Axis";
    badge.textContent = typeLabel;
    badge.className = `curation-type-badge visible ${getSubmissionTypeClass(typeLabel)}`;
  }

  const loadSubmissions = createLoadSubmissions({
    API,
    submissionSelect,
    submissionTypeById,
    setStatus,
    updateSubmissionTypeBadge,
    updateSaveEditsState,
  });

  mapCtl = createCurationMapPreview({
    previewState,
    pendingGeometryEdits,
    featureEnabled,
    getCurrentFeatures: () => currentFeatures,
    getLastPublishedFullLayerId: () => lastPublishedFullLayerIdRef.current,
    featuresContainer,
    onAfterMarkerDrag: async () => {
      renderFeatureList(currentFeatures);
      updateSaveEditsState();
      setStatus("Moved node locally. Click 'Save source edits' to persist changes.", "success");
    },
  });

  const publishedPanel = createPublishedCuratedLayersPanel({
    API,
    publishedLayersContainer,
    escapeHtml,
    setStatus,
    publishedCuratedLayersRef,
    lastPublishedFullLayerIdRef,
    submissionSelect,
    updateSubmissionTypeBadge,
    loadFeatures,
    updatePublishState,
    updateSaveEditsState,
  });

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function renderFeatureList(features) {
    currentFeatures = features || [];
    featureEnabled.clear();
    const container = featuresContainer();
    if (!container) return;

    if (!currentFeatures.length) {
      container.innerHTML =
        '<div class="curation-status">No features in this submission.</div>';
      publishBtn().disabled = true;
      return;
    }

    currentFeatures.forEach((_, i) => {
      featureEnabled.set(i, true);
    });

    container.innerHTML = currentFeatures
      .map((f, i) => {
        const props = f.properties || {};
        const isHistory = props.is_current === false;
        const name =
          props.name ||
          props.description ||
          props.reason ||
          props.id ||
          `Feature ${i + 1}`;
        const subtitle = mapCtl.getSubtitleFromProps(props);
        const id = `curation-f-${i}`;
        const showSubtitle =
          subtitle && String(subtitle).trim() !== String(name).trim();
        const subtitleHtml = showSubtitle
          ? `<div class="curation-feature-meta">${escapeHtml(subtitle)}</div>`
          : "";
        const historyHtml = isHistory
          ? '<div class="curation-feature-meta">History revision</div>'
          : "";
        const memorialIconUrl = getMemorialIconForFeature(props);
        const iconHtml = memorialIconUrl
          ? `<img src="${memorialIconUrl}" alt="" class="curation-feature-icon" />`
          : "";
        return `
          <div class="curation-feature-row">
            <input type="checkbox" id="${id}" data-index="${i}" checked />
            ${iconHtml}
            <div class="curation-feature-content">
              <label for="${id}" class="curation-feature-title">${escapeHtml(String(name))}</label>
              ${subtitleHtml}
              ${historyHtml}
            </div>
            <button type="button" class="curation-feature-edit" data-index="${i}" aria-label="Edit feature" ${isHistory ? "disabled" : ""}>Edit</button>
          </div>`;
      })
      .join("");

    container.querySelectorAll("input[data-index]").forEach((input) => {
      input.addEventListener("change", () => {
        const idx = parseInt(input.getAttribute("data-index"), 10);
        featureEnabled.set(idx, input.checked);
        mapCtl.setFeatureVisibleOnMap(idx, input.checked);
        updatePublishState();
      });
    });

    container.querySelectorAll(".curation-feature-edit").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const idx = parseInt(btn.getAttribute("data-index"), 10);
        openFeatureModal(idx);
      });
    });

    container.querySelectorAll(".curation-feature-row").forEach((row) => {
      row.addEventListener("click", (event) => {
        const target = event.target;
        if (!target) return;
        if (
          target.closest("input[type=\"checkbox\"]") ||
          target.closest(".curation-feature-edit")
        ) {
          return;
        }
        const input = row.querySelector("input[data-index]");
        if (!input) return;
        const idx = parseInt(input.getAttribute("data-index"), 10);
        if (Number.isNaN(idx)) return;
        mapCtl.highlightFeatureOnMap(idx, row);
      });
    });

    publishBtn().disabled = !getSelectedGeojson().features.length;
  }

  function openSubmissionModal() {
    const sid = submissionSelect().value;
    if (!sid) return;
    el("curationModalSubmissionId").value = sid;
    el("curationModalSubmissionName").value = getSubmissionNames()[sid] || "";
    el("curationModalSubmission").classList.add("open");
    el("curationModalSubmission").setAttribute("aria-hidden", "false");
  }

  function closeSubmissionModal() {
    el("curationModalSubmission").classList.remove("open");
    el("curationModalSubmission").setAttribute("aria-hidden", "true");
  }

  function saveSubmissionModal() {
    const sid = el("curationModalSubmissionId").value;
    const name = (el("curationModalSubmissionName").value || "").trim();
    setSubmissionName(sid, name);
    const opts = submissionSelect().querySelectorAll("option");
    opts.forEach((opt) => {
      if (opt.value === sid) {
        const typeLabel = submissionTypeById.get(sid) || "Moreshet Axis";
        opt.textContent = `[${typeLabel}] ${getSubmissionDisplayName(sid)}`;
      }
    });
    updateSubmissionTypeBadge(sid);
    closeSubmissionModal();
  }

  function openFeatureModal(featureIndex) {
    const f = currentFeatures[featureIndex];
    if (!f) return;
    const p = f.properties || {};
    el("curationModalFeatureName").value = p.name != null ? String(p.name) : "";
    el("curationModalFeatureReason").value = p.reason != null ? String(p.reason) : "";
    el("curationModalFeatureDescription").value = p.description != null ? String(p.description) : "";
    el("curationModalFeatureNote").value = p.note != null ? String(p.note) : "";
    el("curationModalFeature").setAttribute("data-feature-index", String(featureIndex));
    el("curationModalFeature").classList.add("open");
    el("curationModalFeature").setAttribute("aria-hidden", "false");
  }

  function closeFeatureModal() {
    el("curationModalFeature").classList.remove("open");
    el("curationModalFeature").setAttribute("aria-hidden", "true");
  }

  function saveFeatureModal() {
    const idx = parseInt(el("curationModalFeature").getAttribute("data-feature-index"), 10);
    const f = currentFeatures[idx];
    if (!f) return;
    f.properties = f.properties || {};
    f.properties.name = (el("curationModalFeatureName").value || "").trim() || undefined;
    f.properties.reason = (el("curationModalFeatureReason").value || "").trim() || undefined;
    f.properties.description = (el("curationModalFeatureDescription").value || "").trim() || undefined;
    f.properties.note = (el("curationModalFeatureNote").value || "").trim() || undefined;
    renderFeatureList(currentFeatures);
    mapCtl.showPreview(
      { type: "FeatureCollection", features: currentFeatures },
      { preserveView: true },
    );
    closeFeatureModal();
  }

  function getSelectedGeojson() {
    const features = currentFeatures
      .filter((_, i) => featureEnabled.get(i))
      .map((f) => ({
        type: "Feature",
        geometry: f.geometry,
        properties: f.properties ? { ...f.properties } : {},
      }));
    return { type: "FeatureCollection", features };
  }

  function updatePublishState() {
    const hasSelection = getSelectedGeojson().features.length > 0;
    const hasName = (layerNameInput().value || "").trim().length > 0;
    publishBtn().disabled = !hasSelection || !hasName;
  }

  function updateSaveEditsState() {
    const btn = saveEditsBtn();
    if (!btn) return;
    const pendingCount = pendingGeometryEdits.size;
    btn.disabled = pendingCount === 0 || !submissionSelect().value;
    btn.textContent =
      pendingCount > 0
        ? `Save source edits (${pendingCount})`
        : "Save source edits";
  }

  async function savePendingEdits() {
    if (!pendingGeometryEdits.size) {
      setStatus("No pending geometry edits to save.");
      updateSaveEditsState();
      return;
    }
    const submissionId = String(submissionSelect().value || "").trim();
    if (!submissionId) {
      setStatus("Select a submission before saving edits.", "error");
      return;
    }

    const btn = saveEditsBtn();
    if (btn) btn.disabled = true;
    setStatus(`Saving ${pendingGeometryEdits.size} source edit(s)…`);

    let savedCount = 0;
    let skippedCount = 0;
    const warnings = [];
    let latestPublishedLayerId = lastPublishedFullLayerIdRef.current || null;
    const edits = Array.from(pendingGeometryEdits.values());
    const groupedEdits = new Map();
    edits.forEach((edit) => {
      const key = `${edit?.sourcePublishedLayerFullId || "auto"}::${edit?.projectId || "none"}`;
      const row = groupedEdits.get(key) || [];
      row.push(edit);
      groupedEdits.set(key, row);
    });
    try {
      for (const group of groupedEdits.values()) {
        if (!Array.isArray(group) || group.length === 0) continue;
        const sourceLayerId = group[0]?.sourcePublishedLayerFullId || null;
        const requestEdits = [];
        for (const edit of group) {
          if (!edit || !edit.featureId) {
            skippedCount += 1;
            continue;
          }
          requestEdits.push({
            feature_id: edit.featureId,
            project_id: edit.projectId || null,
            before_geom: edit.beforeGeom || {},
            after_geom: edit.afterGeom || {},
          });
        }
        if (requestEdits.length === 0) continue;
        const result = await API.editFeaturesBatch({
          table: "otef",
          project_name: CURATED_GROUP_NAME,
          submission_id: submissionId,
          published_layer_full_id: sourceLayerId,
          edits: requestEdits,
        });
        if (result && result.new_full_layer_id) {
          latestPublishedLayerId = String(result.new_full_layer_id);
        }
        if (result && result.warning) {
          warnings.push(String(result.warning));
        }
        savedCount += Number(result?.edits_applied || requestEdits.length);
      }
      lastPublishedFullLayerIdRef.current = latestPublishedLayerId;
      pendingGeometryEdits.clear();
      updateSaveEditsState();
      await publishedPanel.loadPublishedCuratedLayers();
      const skippedSuffix =
        skippedCount > 0 ? ` (${skippedCount} skipped without feature ids)` : "";
      const warningSuffix =
        warnings.length > 0 ? ` Warning: ${warnings[0]}` : "";
      setStatus(`Saved ${savedCount} source edit(s)${skippedSuffix}.${warningSuffix}`, "success");
    } catch (err) {
      updateSaveEditsState();
      setStatus("Could not save source edits: " + (err?.message || String(err)), "error");
    }
  }

  async function loadFeatures(submissionId) {
    mapCtl.clearPreview();
    renderFeatureList([]);
    pendingGeometryEdits.clear();
    updateSaveEditsState();
    lastPublishedFullLayerIdRef.current = null;
    setStatus("Loading…");
    if (!submissionId) {
      featuresContainer().innerHTML =
        '<div class="curation-status">Select a submission to list features.</div>';
      setStatus("");
      return;
    }

    try {
      const geojson = await API.features(submissionId, {
        includeCurrent: historyFilterState.showCurrent,
        includeHistory: historyFilterState.showHistory,
      });
      const features = geojson.features || [];
      await mapCtl.showPreview(geojson);
      renderFeatureList(features);
      setStatus("");
      updateSaveEditsState();
    } catch (e) {
      setStatus("Could not load features: " + e.message, "error");
      renderFeatureList([]);
      updateSaveEditsState();
    }
  }

  function getSelectedProjectName() {
    return CURATED_GROUP_NAME;
  }

  async function publish() {
    const name = (layerNameInput().value || "").trim();
    if (!name) {
      setStatus("Enter a layer name.", "error");
      return;
    }

    const projName = getSelectedProjectName();
    if (!projName) {
      setStatus("Missing curated group name.", "error");
      return;
    }

    const selected = getSelectedGeojson();
    if (!selected.features.length) {
      setStatus("Select at least one feature.", "error");
      return;
    }

    publishBtn().disabled = true;
    setStatus("Publishing…");

    try {
      let payload = selected;
      const crs = payload.crs?.properties?.name || "";
      const firstCoord = CoordUtils.getFirstCoordinate(payload);
      const looksLikeItm =
        firstCoord &&
        Math.abs(firstCoord[0]) >= 1000 &&
        Math.abs(firstCoord[1]) >= 1000;
      if (
        typeof CoordUtils !== "undefined" &&
        (crs.includes("2039") || crs.includes("ITM") || looksLikeItm)
      ) {
        payload =
          crs.includes("2039") || crs.includes("ITM")
            ? CoordUtils.transformGeojsonToWgs84(payload)
            : CoordUtils.transformGeojsonCoords(
                payload,
                (x, y) => {
                  const [lon, lat] = proj4("EPSG:2039", "EPSG:4326", [x, y]);
                  return [lon, lat];
                },
                { crs: "EPSG:4326" }
              );
      } else if (!payload.crs) {
        payload = { ...payload, crs: { type: "name", properties: { name: "EPSG:4326" } } };
      }
      const result = await API.publish(name, payload, projName);
      lastPublishedFullLayerIdRef.current = result.fullLayerId || null;
      await publishedPanel.loadPublishedCuratedLayers();
      setStatus(
        "Published as \"" +
          (result.displayName || name) +
          "\" in group \"" +
          CURATED_GROUP_NAME +
          "\". Layer is available in the projection and remote controller Layers sheet; open views will update automatically.",
        "success"
      );
    } catch (e) {
      const msg = (e && e.message) || (e && typeof e === "object" && e.toString && e.toString()) || String(e) || "Unknown error";
      if (typeof console !== "undefined" && console.error) {
        console.error("[Curation] Publish failed:", e);
      }
      setStatus("Publish failed: " + msg, "error");
      publishBtn().disabled = false;
      updatePublishState();
    }
  }

  function refresh() {
    setStatus("");
    Promise.all([loadSubmissions(), publishedPanel.loadPublishedCuratedLayers()]).then(() => {
      const sid = submissionSelect().value;
      if (sid) loadFeatures(sid);
    });
  }

  function init() {
    mapCtl.initMap();
    loadSubmissions();
    publishedPanel.loadPublishedCuratedLayers();

    const currentToggle = showCurrentCheckbox();
    const historyToggle = showHistoryCheckbox();
    if (currentToggle) currentToggle.checked = historyFilterState.showCurrent;
    if (historyToggle) historyToggle.checked = historyFilterState.showHistory;

    submissionSelect().addEventListener("change", () => {
      updateSubmissionTypeBadge(submissionSelect().value);
      loadFeatures(submissionSelect().value);
      updatePublishState();
      updateSaveEditsState();
    });

    const onHistoryToggleChange = () => {
      historyFilterState = setHistoryFilterState({
        showCurrent: !!showCurrentCheckbox()?.checked,
        showHistory: !!showHistoryCheckbox()?.checked,
      });
      const sid = submissionSelect().value;
      if (sid) loadFeatures(sid);
    };
    showCurrentCheckbox()?.addEventListener("change", onHistoryToggleChange);
    showHistoryCheckbox()?.addEventListener("change", onHistoryToggleChange);

    layerNameInput().addEventListener("input", updatePublishState);

    publishBtn().addEventListener("click", publish);
    saveEditsBtn()?.addEventListener("click", savePendingEdits);
    refreshBtn().addEventListener("click", refresh);

    el("curationEditSubmission").addEventListener("click", openSubmissionModal);

    el("curationModalSubmissionCancel").addEventListener("click", closeSubmissionModal);
    el("curationModalSubmissionSave").addEventListener("click", saveSubmissionModal);
    el("curationModalSubmission").addEventListener("click", (e) => {
      if (e.target === el("curationModalSubmission")) closeSubmissionModal();
    });

    el("curationModalFeatureCancel").addEventListener("click", closeFeatureModal);
    el("curationModalFeatureSave").addEventListener("click", saveFeatureModal);
    el("curationModalFeature").addEventListener("click", (e) => {
      if (e.target === el("curationModalFeature")) closeFeatureModal();
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
