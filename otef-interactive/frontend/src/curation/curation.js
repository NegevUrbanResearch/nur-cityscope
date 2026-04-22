import { LOCALE_EVENT, t } from "../remote/remote-locale.js";
import { createCurationApi } from "./curation-api.js";
import { buildPublishGeojsonFromApiFeatures } from "./curation-publish-geojson.js";
import { createPublishedCuratedLayersPanel } from "./curation-published-layers.js";
import { createSubmissionsPanel } from "./curation-submissions.js";

export { createCurationPreviewState } from "./curation-state.js";

/**
 * Curation page: list Supabase submissions and publish the full current-only
 * feature set as an OTEF layer (name from the selected submission row).
 * Uses API proxy only (no Supabase client on frontend).
 */

(function () {
  const API = createCurationApi();

  const publishedCuratedLayersRef = { current: [] };
  const lastPublishedFullLayerIdRef = { current: null };
  const submissionTypeById = new Map();
  let isPublishing = false;

  const el = (id) => document.getElementById(id);
  const selectedSubmissionInput = () => el("curationSubmission");
  const selectedSubmissionId = () =>
    String(selectedSubmissionInput()?.value || "").trim().toLowerCase();
  const publishBtn = () => el("curationPublish");
  const statusEl = () => el("curationStatus");
  const refreshBtn = () => el("curationRefresh");
  const publishedLayersContainer = () => el("curationPublishedLayers");
  const CURATED_GROUP_NAME = "Moreshet Axis";
  const CURATION_TABLE = "otef";

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
    getSubmissionDisplayName: (id) =>
      submissionsCtlRef.current?.getSubmissionDisplayName?.(id) ?? "",
    getSubmissionColorCss: (id) =>
      submissionsCtlRef.current?.getSubmissionColorCss?.(id) ?? null,
    resolveSubmissionIdByDisplayName: (displayName) =>
      submissionsCtlRef.current?.findSubmissionIdByDisplayName?.(displayName) ?? null,
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
    onSelectionChange: () => {
      lastPublishedFullLayerIdRef.current = null;
      updatePublishState();
    },
    onSubmissionsLoaded: () => publishedPanel.renderPublishedCuratedLayers(),
  });

  const loadSubmissions = () => submissionsCtlRef.current.loadSubmissions();

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  /**
   * Layer display name for publish: full name from the selected submission row.
   */
  function getPublishLayerNameFromSelection() {
    const row = submissionsCtlRef.current?.getSelectedSubmission?.();
    return row?.name != null ? String(row.name).trim() : "";
  }

  function updatePublishState() {
    const btn = publishBtn();
    if (!btn) return;
    const sid = selectedSubmissionId();
    const name = getPublishLayerNameFromSelection();
    btn.disabled = isPublishing || !sid || !name;
  }

  async function publishSelectedCuratedLayer() {
    if (isPublishing) return;
    const sid = selectedSubmissionId();
    const name = getPublishLayerNameFromSelection();
    if (!sid || !name) {
      setStatus(t("curationSelectSubmissionError"), "error");
      return;
    }

    const projName = getSelectedProjectName();
    if (!projName) {
      setStatus(t("curationMissingGroupError"), "error");
      return;
    }

    isPublishing = true;
    updatePublishState();
    try {
      const geojson = await API.features(sid, {
        includeCurrent: true,
        includeHistory: false,
      });
      const selRow = submissionsCtlRef.current?.getSelectedSubmission?.();
      const featureStamp = {};
      if (selRow?.colorCss) {
        featureStamp.display_color = selRow.colorCss;
      }
      if (selRow?.name != null && String(selRow.name).trim() !== "") {
        featureStamp.submission_name = String(selRow.name).trim();
      }
      const selected = buildPublishGeojsonFromApiFeatures(
        geojson.features || [],
        geojson,
        Object.keys(featureStamp).length ? featureStamp : undefined,
      );
      if (!selected.features.length) {
        setStatus(t("curationNoFeaturesError"), "error");
        return;
      }

      const pb = publishBtn();
      if (pb) pb.disabled = true;
      setStatus(t("curationPublishing"));

      let payload = {
        ...selected,
        features: (selected.features || []).map((f) => ({
          ...f,
          properties: { ...(f.properties || {}), submission_id: sid },
        })),
      };
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
      setStatus(t("curationPublishedSuccess", { e: result.displayName || name }), "success");
    } catch (e) {
      const msg = (e && e.message) || (e && typeof e === "object" && e.toString && e.toString()) || String(e) || "Unknown error";
      if (typeof console !== "undefined" && console.error) {
        console.error("[Curation] Publish failed:", e);
      }
      setStatus(t("curationPublishFailed", { e: msg }), "error");
    } finally {
      isPublishing = false;
      updatePublishState();
    }
  }

  function getSelectedProjectName() {
    return CURATED_GROUP_NAME;
  }

  async function unpublishAllCuratedLayers() {
    const ok =
      typeof window === "undefined" || !window.confirm
        ? true
        : window.confirm(t("curationUnpublishAllConfirm"));
    if (!ok) return;
    const btn = el("curationUnpublishAll");
    if (btn) btn.disabled = true;
    setStatus(t("curationUnpublishAllInProgress"));
    try {
      const body = await API.unpublishAllCuratedLayers({ table: CURATION_TABLE });
      lastPublishedFullLayerIdRef.current = null;
      const n = body.removed_count;
      setStatus(
        typeof n === "number"
          ? t("curationUnpublishAllRemovedN", { n })
          : t("curationUnpublishAllSuccess"),
        "success",
      );
      await publishedPanel.loadPublishedCuratedLayers();
      await submissionsCtlRef.current.loadSubmissions({ preserveOnError: true });
    } catch (err) {
      setStatus(t("curationUnpublishAllError", { e: err?.message || String(err) }), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadWorkshopModeUi() {
    const input = el("curationWorkshopAutoPublish");
    if (!input) return;
    input.disabled = true;
    try {
      const on = await API.getWorkshopMode(CURATION_TABLE);
      input.checked = on;
    } catch (e) {
      setStatus(t("curationLoadWorkshopError", { e: e?.message || String(e) }), "error");
      input.checked = false;
    } finally {
      input.disabled = false;
    }
  }

  async function onWorkshopModeToggle() {
    const input = el("curationWorkshopAutoPublish");
    if (!input || input.disabled) return;
    const next = input.checked;
    input.disabled = true;
    try {
      await API.setWorkshopMode(next, CURATION_TABLE);
      setStatus(
        next ? t("curationWorkshopOnSuccess") : t("curationWorkshopOffSuccess"),
        "success",
      );
    } catch (e) {
      input.checked = !next;
      setStatus(t("curationUpdateWorkshopError", { e: e?.message || String(e) }), "error");
    } finally {
      input.disabled = false;
    }
  }

  function refresh() {
    setStatus("");
    void loadWorkshopModeUi();
    Promise.all([loadSubmissions(), publishedPanel.loadPublishedCuratedLayers()]).then(() => {
      updatePublishState();
    });
  }

  function init() {
    void Promise.all([
      submissionsCtlRef.current.loadSubmissions(),
      publishedPanel.loadPublishedCuratedLayers(),
    ]).then(() => updatePublishState());
    void loadWorkshopModeUi();

    publishBtn()?.addEventListener("click", () => {
      void publishSelectedCuratedLayer();
    });
    el("curationUnpublishAll")?.addEventListener("click", () => {
      void unpublishAllCuratedLayers();
    });
    el("curationWorkshopAutoPublish")?.addEventListener("change", () => {
      void onWorkshopModeToggle();
    });
    refreshBtn()?.addEventListener("click", refresh);
    el("curationSubmissionsRefresh")?.addEventListener("click", refresh);

    if (typeof window !== "undefined") {
      window.addEventListener(LOCALE_EVENT, () => {
        submissionsCtlRef.current?.rerenderForLocale?.();
        publishedPanel.renderPublishedCuratedLayers();
      });
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
