import { getMemorialIconForFeature } from "../shared/curated-layer-service.js";
import {
  createCurationPreviewState,
  getHistoryFilterState,
  setHistoryFilterState,
} from "./curation-state.js";
import { createCurationApi } from "./curation-api.js";
import { createPublishedCuratedLayersPanel } from "./curation-published-layers.js";
import { createSubmissionsPanel } from "./curation-submissions.js";
import {
  createCurationMapPreview,
  initCurationMapRouteLegend,
} from "./curation-map-preview.js";

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
  let isPublishing = false;

  let mapCtl;

  const el = (id) => document.getElementById(id);
  const selectedSubmissionInput = () => el("curationSubmission");
  const selectedSubmissionId = () =>
    String(selectedSubmissionInput()?.value || "").trim();
  const featuresContainer = () => el("curationFeatures");
  const layerNameInput = () => el("curationLayerName");
  const publishBtn = () => el("curationPublish");
  const statusEl = () => el("curationStatus");
  const refreshBtn = () => el("curationRefresh");
  const saveEditsBtn = () => el("curationSaveEdits");
  const publishedLayersContainer = () => el("curationPublishedLayers");
  const publishModalOverlay = () => el("curationModalPublish");
  const CURATED_GROUP_NAME = "Moreshet Axis";
  let historyFilterState = getHistoryFilterState();

  function setStatus(msg, type) {
    const s = statusEl();
    if (!s) return;
    s.textContent = msg || "";
    s.className = "curation-status" + (type ? " " + type : "");
  }

  const submissionsCtlRef = { current: null };

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
  initCurationMapRouteLegend();

  const publishedPanel = createPublishedCuratedLayersPanel({
    API,
    publishedLayersContainer,
    escapeHtml,
    setStatus,
    publishedCuratedLayersRef,
    lastPublishedFullLayerIdRef,
    selectSubmissionById: (id) => submissionsCtlRef.current?.selectSubmissionById(id),
    submissionExists: (id) => Boolean(submissionsCtlRef.current?.hasSubmissionId(id)),
  });

  submissionsCtlRef.current = createSubmissionsPanel({
    API,
    getSearchInput: () => el("curationSubmissionSearch"),
    getListContainer: () => el("curationSubmissionList"),
    getComboRoot: () => el("curationSubmissionCombo"),
    getComboField: () => el("curationSubmissionComboField"),
    getSelectedTagsContainer: () => el("curationSubmissionSelectedTags"),
    getSelectedIdInput: () => selectedSubmissionInput(),
    submissionTypeById,
    setStatus,
    updateSaveEditsState,
    onSelectionChange: (id) => {
      syncLayerNameFromSelectedSubmission(id);
      void loadFeatures(id);
      updatePublishState();
      updateSaveEditsState();
    },
  });

  const loadSubmissions = () => submissionsCtlRef.current.loadSubmissions();

  /**
   * Default layer name from the selected submission row (still editable in the input).
   * @param {string} submissionId
   */
  function syncLayerNameFromSelectedSubmission(submissionId) {
    const input = layerNameInput();
    if (!input) return;
    const sid = String(submissionId || "").trim();
    if (!sid) {
      input.value = "";
      return;
    }
    const row = submissionsCtlRef.current?.getSelectedSubmission?.();
    const name = row?.name != null ? String(row.name).trim() : "";
    input.value = name;
  }

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
      updatePublishState();
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
          <div class="curation-feature-row${isHistory ? " curation-feature-row--history" : ""}">
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

    updatePublishState();
  }

  function openFeatureModal(featureIndex) {
    const f = currentFeatures[featureIndex];
    if (!f) return;
    const p = f.properties || {};
    if (p.is_current === false) return;
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

  /**
   * @param {boolean} [includeHistoryInPayload=true] When false, drops checked features with `is_current === false`.
   */
  function getSelectedGeojson(includeHistoryInPayload = true) {
    const features = currentFeatures
      .filter((f, i) => {
        if (!featureEnabled.get(i)) return false;
        if (
          !includeHistoryInPayload &&
          (f.properties || {}).is_current === false
        ) {
          return false;
        }
        return true;
      })
      .map((f) => ({
        type: "Feature",
        geometry: f.geometry,
        properties: f.properties ? { ...f.properties } : {},
      }));
    return { type: "FeatureCollection", features };
  }

  function updatePublishState() {
    const hasSelection = getSelectedGeojson(true).features.length > 0;
    const hasName = (layerNameInput().value || "").trim().length > 0;
    publishBtn().disabled = isPublishing || !hasSelection || !hasName;
  }

  function updateSaveEditsState() {
    const btn = saveEditsBtn();
    if (!btn) return;
    const pendingCount = pendingGeometryEdits.size;
    btn.disabled = pendingCount === 0 || !selectedSubmissionId();
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
    const submissionId = selectedSubmissionId();
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
          const srcFeat = currentFeatures.find(
            (cf) =>
              cf?.properties?.id != null &&
              String(cf.properties.id) === String(edit.featureId),
          );
          if (srcFeat?.properties?.is_current === false) {
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
      await submissionsCtlRef.current.loadSubmissions({ preserveOnError: true });
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
        includeCurrent: true,
        includeHistory: historyFilterState.showOldRevisions,
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

  function openPublishDialog() {
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

    if (getSelectedGeojson(true).features.length === 0) {
      setStatus("Select at least one feature.", "error");
      return;
    }

    setPublishModeSegmentState(false);

    const overlay = publishModalOverlay();
    if (!overlay) return;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
  }

  function closePublishDialog() {
    const overlay = publishModalOverlay();
    if (!overlay) return;
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  }

  function setPublishDialogBusy(isBusy) {
    const confirmBtn = el("curationModalPublishConfirm");
    if (confirmBtn) confirmBtn.disabled = !!isBusy;
  }

  function confirmPublishFromDialog() {
    if (isPublishing) return;
    const historyBtn = el("curationPublishModeHistory");
    const includeHistory = historyBtn?.getAttribute("aria-pressed") === "true";
    void publishWithOptions(includeHistory);
  }

  /** @param {boolean} includeHistory */
  function setPublishModeSegmentState(includeHistory) {
    const cur = el("curationPublishModeCurrent");
    const hist = el("curationPublishModeHistory");
    if (cur) cur.setAttribute("aria-pressed", includeHistory ? "false" : "true");
    if (hist) hist.setAttribute("aria-pressed", includeHistory ? "true" : "false");
  }

  function syncHistoryRevisionSegmentUI() {
    const cur = el("curationHistoryFilterCurrent");
    const hist = el("curationHistoryFilterWithHistory");
    const show = historyFilterState.showOldRevisions;
    if (cur) cur.setAttribute("aria-pressed", show ? "false" : "true");
    if (hist) hist.setAttribute("aria-pressed", show ? "true" : "false");
  }

  async function publishWithOptions(includeHistoryInPayload) {
    if (isPublishing) return;
    isPublishing = true;
    setPublishDialogBusy(true);
    updatePublishState();
    try {
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

      const selected = getSelectedGeojson(includeHistoryInPayload);
      if (!selected.features.length) {
        setStatus(
          includeHistoryInPayload
            ? "Select at least one feature."
            : "Select at least one current feature (history excluded in Current only).",
          "error",
        );
        return;
      }

      closePublishDialog();

      publishBtn().disabled = true;
      setStatus("Publishing…");

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
    } finally {
      isPublishing = false;
      setPublishDialogBusy(false);
      updatePublishState();
    }
  }

  function refresh() {
    setStatus("");
    Promise.all([loadSubmissions(), publishedPanel.loadPublishedCuratedLayers()]).then(() => {
      const sid = selectedSubmissionId();
      if (sid) loadFeatures(sid);
    });
  }

  function init() {
    mapCtl.initMap();
    loadSubmissions();
    publishedPanel.loadPublishedCuratedLayers();

    syncHistoryRevisionSegmentUI();
    el("curationHistoryFilterCurrent")?.addEventListener("click", () => {
      if (!historyFilterState.showOldRevisions) return;
      historyFilterState = setHistoryFilterState({ showOldRevisions: false });
      syncHistoryRevisionSegmentUI();
      const sid = selectedSubmissionId();
      if (sid) loadFeatures(sid);
    });
    el("curationHistoryFilterWithHistory")?.addEventListener("click", () => {
      if (historyFilterState.showOldRevisions) return;
      historyFilterState = setHistoryFilterState({ showOldRevisions: true });
      syncHistoryRevisionSegmentUI();
      const sid = selectedSubmissionId();
      if (sid) loadFeatures(sid);
    });

    layerNameInput().addEventListener("input", updatePublishState);

    publishBtn().addEventListener("click", openPublishDialog);
    el("curationPublishModeCurrent")?.addEventListener("click", () =>
      setPublishModeSegmentState(false),
    );
    el("curationPublishModeHistory")?.addEventListener("click", () =>
      setPublishModeSegmentState(true),
    );
    el("curationModalPublishCancel")?.addEventListener("click", closePublishDialog);
    el("curationModalPublishConfirm")?.addEventListener("click", confirmPublishFromDialog);
    publishModalOverlay()?.addEventListener("click", (e) => {
      if (e.target === publishModalOverlay()) closePublishDialog();
    });
    saveEditsBtn()?.addEventListener("click", savePendingEdits);
    refreshBtn().addEventListener("click", refresh);

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
