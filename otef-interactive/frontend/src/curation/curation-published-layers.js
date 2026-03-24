/**
 * Published curated layers list: load, render, unpublish, submission click-through.
 */

export function extractSubmissionIdsFromLayerData(layerData) {
  const ids = new Set();
  const features = layerData && Array.isArray(layerData.features) ? layerData.features : [];
  features.forEach((feature) => {
    const props = feature && feature.properties ? feature.properties : {};
    const sid = props.submission_id ?? props.submissionId ?? null;
    if (sid != null && String(sid).trim() !== "") {
      ids.add(String(sid).trim());
    }
  });
  return Array.from(ids);
}

/**
 * @param {object} deps
 * @param {ReturnType<import("./curation-api.js").createCurationApi>} deps.API
 * @param {() => HTMLElement | null} deps.publishedLayersContainer
 * @param {(s: string) => string} deps.escapeHtml
 * @param {(msg: string, type?: string) => void} deps.setStatus
 * @param {{ current: Array<{ fullLayerId: string; displayName: string; submissionId: string }> }} deps.publishedCuratedLayersRef
 * @param {{ current: string | null }} deps.lastPublishedFullLayerIdRef
 * @param {() => HTMLSelectElement | null} deps.submissionSelect
 * @param {(submissionId: string) => void} deps.updateSubmissionTypeBadge
 * @param {(submissionId: string) => Promise<void>} deps.loadFeatures
 * @param {() => void} deps.updatePublishState
 * @param {() => void} deps.updateSaveEditsState
 */
export function createPublishedCuratedLayersPanel(deps) {
  const {
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
  } = deps;

  function renderPublishedCuratedLayers() {
    const container = publishedLayersContainer();
    if (!container) return;
    const publishedCuratedLayers = publishedCuratedLayersRef.current;
    if (!Array.isArray(publishedCuratedLayers) || publishedCuratedLayers.length === 0) {
      container.innerHTML =
        '<div class="curation-status">No published curated layers.</div>';
      return;
    }
    container.innerHTML = publishedCuratedLayers
      .map((layer) => {
        const fullLayerId = String(layer.fullLayerId || "");
        const displayName = String(layer.displayName || fullLayerId);
        const submissionId = String(layer.submissionId || "");
        const submissionMeta = submissionId
          ? `Submission: ${submissionId}`
          : "Submission: multiple/unknown";
        return `
          <div class="curation-feature-row" data-full-layer-id="${escapeHtml(fullLayerId)}" data-submission-id="${escapeHtml(submissionId)}">
            <div class="curation-feature-content">
              <div class="curation-feature-title">${escapeHtml(displayName)}</div>
              <div class="curation-feature-meta">${escapeHtml(fullLayerId)}</div>
              <div class="curation-feature-meta">${escapeHtml(submissionMeta)}</div>
            </div>
            <button type="button" class="curation-feature-edit curation-unpublish-btn" data-full-layer-id="${escapeHtml(fullLayerId)}" aria-label="Remove layer from remote">Remove</button>
          </div>`;
      })
      .join("");

    container.querySelectorAll(".curation-feature-row").forEach((row) => {
      row.addEventListener("click", async (event) => {
        if (event.target && event.target.closest(".curation-unpublish-btn")) return;
        const submissionId = String(row.getAttribute("data-submission-id") || "").trim();
        if (!submissionId) {
          setStatus("This published layer maps to multiple/unknown submissions.", "error");
          return;
        }
        const select = submissionSelect();
        if (!select) return;
        const hasOption = Array.from(select.options).some((opt) => opt.value === submissionId);
        if (!hasOption) {
          setStatus(`Submission ${submissionId} is not available in the dropdown.`, "error");
          return;
        }
        select.value = submissionId;
        updateSubmissionTypeBadge(submissionId);
        await loadFeatures(submissionId);
        updatePublishState();
        updateSaveEditsState();
        setStatus(`Loaded submission ${submissionId} from published layer.`, "success");
      });
    });

    container.querySelectorAll(".curation-unpublish-btn").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const fullLayerId = String(btn.getAttribute("data-full-layer-id") || "");
        if (!fullLayerId) return;
        const ok = typeof window === "undefined" || !window.confirm
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
      const activeById = new Map(
        activeLayers.map((layer) => [String(layer.id), layer]),
      );
      const layerGroups = Array.isArray(state?.layerGroups) ? state.layerGroups : [];
      const curatedGroup = layerGroups.find((g) => g && g.id === "curated_moresht_axis");
      const primary = (curatedGroup?.layers || [])
        .filter((layer) => layer && activeById.has(String(layer.id)))
        .map((layer) => ({
          fullLayerId: `curated_moresht_axis.${String(layer.id)}`,
          displayName: layer.displayName || String(layer.id),
          submissionId: (() => {
            const source = activeById.get(String(layer.id));
            const ids = extractSubmissionIdsFromLayerData(source?.data);
            return ids.length === 1 ? ids[0] : "";
          })(),
        }));
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
        .map((layer) => ({
          fullLayerId: `curated_moresht_axis.${String(layer.id)}`,
          displayName: String(layer.display_name || layer.name || layer.id),
          submissionId: (() => {
            const ids = extractSubmissionIdsFromLayerData(layer.data);
            return ids.length === 1 ? ids[0] : "";
          })(),
        }));
      renderPublishedCuratedLayers();
    } catch (err) {
      publishedCuratedLayersRef.current = [];
      container.innerHTML = `<div class="curation-status error">Could not load published curated layers: ${escapeHtml(err?.message || String(err))}</div>`;
    }
  }

  return { loadPublishedCuratedLayers, renderPublishedCuratedLayers };
}
