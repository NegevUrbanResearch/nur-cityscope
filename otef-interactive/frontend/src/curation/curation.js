import { getMemorialIconForFeature } from "../shared/curated-layer-service.js";
import { createCurationApi } from "./curation-api.js";
import { createPublishedCuratedLayersPanel } from "./curation-published-layers.js";
import { createSubmissionsPanel } from "./curation-submissions.js";

export { createCurationPreviewState } from "./curation-state.js";

/**
 * Curation page: list Supabase submissions, toggle features for publish, name and
 * publish as OTEF layer. Uses API proxy only (no Supabase client on frontend).
 */

(function () {
  const API = createCurationApi();

  let currentFeatures = [];
  const featureEnabled = new Map();
  const publishedCuratedLayersRef = { current: [] };
  const lastPublishedFullLayerIdRef = { current: null };
  const submissionTypeById = new Map();
  let isPublishing = false;

  const el = (id) => document.getElementById(id);
  const selectedSubmissionInput = () => el("curationSubmission");
  const selectedSubmissionId = () =>
    String(selectedSubmissionInput()?.value || "").trim();
  const featuresContainer = () => el("curationFeatures");
  const layerNameInput = () => el("curationLayerName");
  const publishBtn = () => el("curationPublish");
  const statusEl = () => el("curationStatus");
  const refreshBtn = () => el("curationRefresh");
  const publishedLayersContainer = () => el("curationPublishedLayers");
  const publishModalOverlay = () => el("curationModalPublish");
  const CURATED_GROUP_NAME = "Moreshet Axis";

  function setStatus(msg, type) {
    const s = statusEl();
    if (!s) return;
    s.textContent = msg || "";
    s.className = "curation-status" + (type ? " " + type : "");
  }

  const submissionsCtlRef = { current: null };

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
    onSelectionChange: (id) => {
      syncLayerNameFromSelectedSubmission(id);
      void loadFeatures(id);
      updatePublishState();
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
        const subtitle = subtitleFromProps(props);
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
          <div class="curation-feature-row curation-feature-row--pick${isHistory ? " curation-feature-row--history" : ""}">
            <input type="checkbox" id="${id}" data-index="${i}" checked />
            ${iconHtml}
            <div class="curation-feature-content">
              <label for="${id}" class="curation-feature-title">${escapeHtml(String(name))}</label>
              ${subtitleHtml}
              ${historyHtml}
            </div>
          </div>`;
      })
      .join("");

    container.querySelectorAll("input[data-index]").forEach((input) => {
      input.addEventListener("change", () => {
        const idx = parseInt(input.getAttribute("data-index"), 10);
        featureEnabled.set(idx, input.checked);
        updatePublishState();
      });
    });

    updatePublishState();
  }

  function subtitleFromProps(props) {
    const p = props || {};
    const reason = p.reason != null ? String(p.reason).trim() : "";
    const desc = p.description != null ? String(p.description).trim() : "";
    const note = p.note != null ? String(p.note).trim() : "";
    const id = p.id != null ? String(p.id).trim() : "";
    const bits = [];
    if (reason) bits.push(reason);
    if (desc && desc !== reason) bits.push(desc);
    if (note) bits.push(note);
    if (id) bits.push(`id: ${id}`);
    return bits.join(" · ");
  }

  /**
   * @param {boolean} [includeHistoryInPayload=false] When false, drops checked features with `is_current === false`.
   */
  function getSelectedGeojson(includeHistoryInPayload = false) {
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
    const hasSelection = getSelectedGeojson().features.length > 0;
    const hasName = (layerNameInput().value || "").trim().length > 0;
    publishBtn().disabled = isPublishing || !hasSelection || !hasName;
  }

  async function loadFeatures(submissionId) {
    renderFeatureList([]);
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
        includeHistory: false,
      });
      const features = geojson.features || [];
      renderFeatureList(features);
      setStatus("");
    } catch (e) {
      setStatus("Could not load features: " + e.message, "error");
      renderFeatureList([]);
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

    if (getSelectedGeojson().features.length === 0) {
      setStatus("Select at least one feature.", "error");
      return;
    }

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
    void publishSelectedCuratedLayer();
  }

  async function publishSelectedCuratedLayer() {
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

      const selected = getSelectedGeojson();
      if (!selected.features.length) {
        setStatus("Select at least one current feature.", "error");
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

  async function unpublishAllCuratedLayers() {
    const ok =
      typeof window === "undefined" || !window.confirm
        ? true
        : window.confirm("Remove all published curated layers from the remote?");
    if (!ok) return;
    const btn = el("curationUnpublishAll");
    if (btn) btn.disabled = true;
    setStatus("Removing all published curated layers…");
    try {
      const r = await fetch("/api/supabase/curated/unpublish-all/", {
        method: "POST",
        headers: API._writeHeaders(),
        body: JSON.stringify({ table: "otef" }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(body.error || `Unpublish all failed (${r.status})`);
      }
      lastPublishedFullLayerIdRef.current = null;
      const n = body.removed_count;
      setStatus(
        typeof n === "number"
          ? `Removed ${n} published layer(s) from remote.`
          : "All published curated layers removed from remote.",
        "success",
      );
      await publishedPanel.loadPublishedCuratedLayers();
      await submissionsCtlRef.current.loadSubmissions({ preserveOnError: true });
    } catch (err) {
      setStatus("Could not unpublish all: " + (err?.message || String(err)), "error");
    } finally {
      if (btn) btn.disabled = false;
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
    loadSubmissions();
    publishedPanel.loadPublishedCuratedLayers();

    layerNameInput().addEventListener("input", updatePublishState);

    publishBtn().addEventListener("click", openPublishDialog);
    el("curationModalPublishCancel")?.addEventListener("click", closePublishDialog);
    el("curationModalPublishConfirm")?.addEventListener("click", confirmPublishFromDialog);
    publishModalOverlay()?.addEventListener("click", (e) => {
      if (e.target === publishModalOverlay()) closePublishDialog();
    });
    el("curationUnpublishAll")?.addEventListener("click", () => {
      void unpublishAllCuratedLayers();
    });
    refreshBtn().addEventListener("click", refresh);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
