/**
 * Curation page: list Supabase projects/submissions, Leaflet preview,
 * toggle features, name and publish as OTEF layer.
 * Uses API proxy only (no Supabase client on frontend).
 */

(function () {
  const API = {
    async projects() {
      const r = await fetch("/api/supabase/projects/");
      let body = {};
      const text = await r.text();
      try {
        body = text ? JSON.parse(text) : {};
      } catch (_) {
        if (r.status === 502 && /<title>.*502.*<\/title>/i.test(text)) {
          body = { error: "API unavailable (502). Ensure the backend (nur-api) is running and try again." };
        } else {
          body = { error: text ? text.slice(0, 200) : `Server returned ${r.status}` };
        }
      }
      if (!r.ok) {
        const msg = body.error || `Failed to load projects (${r.status}). Check API and Supabase configuration.`;
        throw new Error(msg);
      }
      return body;
    },
    async submissions(projectId) {
      const r = await fetch(
        `/api/supabase/projects/${projectId}/submissions/`
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Failed to load submissions (${r.status})`);
      return body;
    },
    async features(submissionId) {
      const r = await fetch(
        `/api/supabase/submissions/${submissionId}/features/`
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Failed to load features (${r.status})`);
      return body;
    },
    async publish(name, geojsonItm) {
      const r = await fetch("/api/supabase/curated/publish/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, geojson: geojsonItm, table: "otef" }),
      });
      const text = await r.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        data = { error: r.status === 502 ? "API unavailable." : (text ? text.slice(0, 150) : "Request failed") };
      }
      const errMsg = data.error || data.detail || data.message;
      if (!r.ok) throw new Error(errMsg || `Publish failed (${r.status})`);
      return data;
    },
  };

  let map = null;
  let currentLayer = null;
  let currentFeatures = [];
  let featureEnabled = new Map();

  const el = (id) => document.getElementById(id);
  const projectSelect = () => el("curationProject");
  const submissionSelect = () => el("curationSubmission");
  const featuresContainer = () => el("curationFeatures");
  const layerNameInput = () => el("curationLayerName");
  const publishBtn = () => el("curationPublish");
  const statusEl = () => el("curationStatus");
  const refreshBtn = () => el("curationRefresh");
  const pollingCheckbox = () => el("curationPolling");

  function setStatus(msg, type) {
    const s = statusEl();
    if (!s) return;
    s.textContent = msg || "";
    s.className = "curation-status" + (type ? " " + type : "");
  }

  function initMap() {
    const container = document.getElementById("curationMap");
    if (!container || map) return map;
    map = L.map(container, { center: [32.08, 34.78], zoom: 12 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(map);
    return map;
  }

  function clearPreview() {
    if (currentLayer && map) {
      map.removeLayer(currentLayer);
      currentLayer = null;
    }
  }

  function showPreview(geojson) {
    if (!map) initMap();
    clearPreview();
    if (!geojson || !geojson.features || !geojson.features.length) return;
    currentLayer = L.geoJSON(geojson, {
      style: {
        color: "#00d4ff",
        weight: 2,
        fillOpacity: 0.3,
      },
    }).addTo(map);
    map.fitBounds(currentLayer.getBounds(), { padding: [20, 20] });
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

    currentFeatures.forEach((f, i) => {
    featureEnabled.set(i, true);
    });

    container.innerHTML = currentFeatures
      .map((f, i) => {
        const name =
          f.properties?.name ||
          f.properties?.description ||
          f.id ||
          `Feature ${i + 1}`;
        const id = `curation-f-${i}`;
        return `
          <div class="curation-feature-row">
            <input type="checkbox" id="${id}" data-index="${i}" checked />
            <label for="${id}">${escapeHtml(String(name))}</label>
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

    publishBtn().disabled = !getSelectedGeojson().features.length;
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function getFirstCoordinate(geojson) {
    if (!geojson?.features?.length) return null;
    for (const feature of geojson.features) {
      if (!feature.geometry?.coordinates) continue;
      let coords = feature.geometry.coordinates;
      while (Array.isArray(coords) && Array.isArray(coords[0])) coords = coords[0];
      if (Array.isArray(coords) && typeof coords[0] === "number") return coords;
    }
    return null;
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

  async function loadProjects() {
    try {
      const list = await API.projects();
      const select = projectSelect();
      if (!select) return;
      const current = select.value;
      select.innerHTML =
        '<option value="">— Select project —</option>' +
        (Array.isArray(list)
          ? list
          : []
        )
          .map((p) => {
            const id = p.id ?? p.project_id ?? p;
            const name = p.name ?? p.display_name ?? String(id);
            return `<option value="${escapeHtml(String(id))}">${escapeHtml(String(name))}</option>`;
          })
          .join("");
      if (current) select.value = current;
    } catch (e) {
      setStatus("Could not load projects: " + e.message, "error");
    }
  }

  async function loadSubmissions(projectId) {
    const subSelect = submissionSelect();
    if (!subSelect) return;
    subSelect.disabled = true;
    subSelect.innerHTML = "<option value=\"\">— Select submission —</option>";
    if (!projectId) return;

    try {
      const list = await API.submissions(projectId);
      list.forEach((s) => {
        const id = s.id ?? s.submission_id ?? s;
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = String(id).slice(0, 8) + (String(id).length > 8 ? "…" : "");
        subSelect.appendChild(opt);
      });
      subSelect.disabled = false;
    } catch (e) {
      setStatus("Could not load submissions: " + e.message, "error");
      subSelect.disabled = false;
    }
  }

  async function loadFeatures(submissionId) {
    clearPreview();
    renderFeatureList([]);
    setStatus("Loading…");
    if (!submissionId) {
      featuresContainer().innerHTML =
        '<div class="curation-status">Select a submission to list features.</div>';
      setStatus("");
      return;
    }

    try {
      const geojson = await API.features(submissionId);
      const features = geojson.features || [];
      showPreview(geojson);
      renderFeatureList(features);
      setStatus("");
    } catch (e) {
      setStatus("Could not load features: " + e.message, "error");
      renderFeatureList([]);
    }
  }

  async function publish() {
    const name = (layerNameInput().value || "").trim();
    if (!name) {
      setStatus("Enter a layer name.", "error");
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
      const firstCoord = getFirstCoordinate(payload);
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
      const result = await API.publish(name, payload);
      setStatus(
        "Published as \"" + (result.displayName || name) + "\". Layer is available in the projection and remote controller Layers sheet; open views will update automatically.",
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
    loadProjects();
    const pid = projectSelect().value;
    if (pid) loadSubmissions(pid);
    const sid = submissionSelect().value;
    if (sid) loadFeatures(sid);
  }

  let pollTimer = null;
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 30000);
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function init() {
    initMap();
    loadProjects();

    projectSelect().addEventListener("change", () => {
      const id = projectSelect().value;
      submissionSelect().value = "";
      loadSubmissions(id);
      loadFeatures(null);
    });

    submissionSelect().addEventListener("change", () => {
      loadFeatures(submissionSelect().value);
    });

    layerNameInput().addEventListener("input", updatePublishState);

    publishBtn().addEventListener("click", publish);
    refreshBtn().addEventListener("click", refresh);

    pollingCheckbox().addEventListener("change", (e) => {
      if (e.target.checked) startPolling();
      else stopPolling();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
