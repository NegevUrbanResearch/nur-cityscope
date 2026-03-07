import { getMemorialIconForFeature } from "../shared/curated-layer-service.js";
import {
  parseDefaultLinePaths,
  buildIntegratedRoute,
} from "../map-utils/pink-line-route.js";

/**
 * Curation page: list Supabase projects/submissions, Leaflet preview with
 * pink line (הקו_הורוד) base route, submission features as dashed lines and
 * labeled points. Toggle features, name and publish as OTEF layer.
 * Uses API proxy only (no Supabase client on frontend).
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

(function () {
  const LABEL_PROPERTY_KEYS = ["name", "reason", "description", "note"];
  const META_SUBTITLE_KEYS = ["reason", "description", "note"];

  const MEMORIAL_ICONS = {
    central: "/otef-interactive/img/memorial-sites/regional-memorial-site.png",
    local: "/otef-interactive/img/memorial-sites/local-memorial-site.png",
  };

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
    async publish(name, geojsonItm, projectName) {
      const r = await fetch("/api/supabase/curated/publish/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          geojson: geojsonItm,
          table: "otef",
          project_name: projectName,
        }),
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
  let baseRouteLayer = null;
  let integratedRouteLayer = null;
  let currentFeatures = [];
  let featureEnabled = new Map();
  const previewState = createCurationPreviewState();
  let highlightMarker = null;

  const el = (id) => document.getElementById(id);
  const projectSelect = () => el("curationProject");
  const submissionSelect = () => el("curationSubmission");
  const featuresContainer = () => el("curationFeatures");
  const layerNameInput = () => el("curationLayerName");
  const publishBtn = () => el("curationPublish");
  const statusEl = () => el("curationStatus");
  const refreshBtn = () => el("curationRefresh");
  const SUBMISSION_NAMES_KEY = "curation_submission_names";

  function setStatus(msg, type) {
    const s = statusEl();
    if (!s) return;
    s.textContent = msg || "";
    s.className = "curation-status" + (type ? " " + type : "");
  }

  function getSubmissionNames() {
    try {
      const raw = localStorage.getItem(SUBMISSION_NAMES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function setSubmissionName(submissionId, name) {
    const names = getSubmissionNames();
    if (name != null && String(name).trim() !== "") {
      names[submissionId] = String(name).trim();
    } else {
      delete names[submissionId];
    }
    localStorage.setItem(SUBMISSION_NAMES_KEY, JSON.stringify(names));
  }

  function getSubmissionDisplayName(submissionId) {
    const names = getSubmissionNames();
    const custom = names[submissionId];
    if (custom != null && String(custom).trim() !== "") return String(custom).trim();
    const idStr = String(submissionId);
    return idStr.slice(0, 8) + (idStr.length > 8 ? "…" : "");
  }

  function getSelectedProjectName() {
    const select = projectSelect();
    if (!select) return "";
    const option = select.options[select.selectedIndex] || null;
    return option ? (option.textContent || "").trim() : "";
  }

  function getLabelFromProps(properties) {
    const p = properties || {};
    for (const key of LABEL_PROPERTY_KEYS) {
      const v = p[key];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return null;
  }

  function getSubtitleFromProps(properties) {
    const p = properties || {};
    for (const key of META_SUBTITLE_KEYS) {
      const v = p[key];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return null;
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
    if (baseRouteLayer && map) {
      map.removeLayer(baseRouteLayer);
      baseRouteLayer = null;
    }

    if (integratedRouteLayer && map) {
      map.removeLayer(integratedRouteLayer);
      integratedRouteLayer = null;
    }

    // Remove any per-feature layers from the map.
    if (map && previewState && previewState.featureLayers) {
      for (const layers of previewState.featureLayers.values()) {
        (layers || []).forEach((layer) => {
          if (!layer) return;
          if (typeof map.hasLayer === "function" && map.hasLayer(layer)) {
            map.removeLayer(layer);
          } else if (typeof map.removeLayer === "function") {
            try {
              map.removeLayer(layer);
            } catch (_) {
              // ignore
            }
          }
        });
      }
    }

    previewState.clearPreview();

    if (highlightMarker && map && typeof map.removeLayer === "function") {
      try {
        map.removeLayer(highlightMarker);
      } catch (_) {
        // ignore
      }
    }
    highlightMarker = null;
  }

  async function loadPinkLineGeojson() {
    try {
      const res = await fetch("/api/pink-line/");
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }


  function getGeometryType(geometry) {
    if (!geometry || !geometry.type) return null;
    const t = geometry.type.toLowerCase();
    if (t === "point" || t === "multipoint") return "point";
    if (t === "linestring" || t === "multilinestring") return "line";
    return "polygon";
  }

  function createFeatureLayer(feature) {
    if (!feature || !feature.geometry || typeof L === "undefined") return null;
    const geomType = getGeometryType(feature.geometry);

    if (geomType === "point") {
      const layerColor = "#00d4ff";
      return L.geoJSON(
        { type: "FeatureCollection", features: [feature] },
        {
          pointToLayer: (f, latlng) => {
            const props = f.properties || {};
            const memorialIconUrl = getMemorialIconForFeature(props);

            let marker;
            if (memorialIconUrl) {
              const icon = L.icon({
                iconUrl: memorialIconUrl,
                iconSize: [36, 36],
                iconAnchor: [18, 18],
                popupAnchor: [0, -18],
                className: "curation-memorial-marker-icon",
              });
              marker = L.marker(latlng, { icon });
            } else {
              marker = L.marker(latlng, {
                icon: L.divIcon({
                  className: "pink-line-node-marker",
                  html:
                    '<div class="pink-line-node" style="background:' +
                    layerColor +
                    '"></div>',
                  iconSize: [14, 14],
                  iconAnchor: [7, 7],
                }),
              });
            }

            const label = getLabelFromProps(props);
            if (label) {
              marker.bindTooltip(label, {
                permanent: false,
                direction: "top",
                className: "curated-node-tooltip",
              });
            }

            return marker;
          },
        }
      );
    }

    if (geomType === "line") {
      const lineStyle = { color: "#00d4ff", weight: 2.5, dashArray: "8,6", opacity: 0.95 };
      return L.geoJSON(
        { type: "FeatureCollection", features: [feature] },
        { style: lineStyle }
      );
    }

    const otherStyle = { color: "#00d4ff", weight: 2, fillOpacity: 0.3 };
    return L.geoJSON(
      { type: "FeatureCollection", features: [feature] },
      { style: otherStyle }
    );
  }

  function setFeatureVisibleOnMap(featureIndex, isVisible) {
    previewState.setFeatureVisible(featureIndex, isVisible);
    if (!map) return;
    const key = String(featureIndex);
    const layers = previewState.featureLayers.get(key) || [];
    layers.forEach((layer) => {
      if (!layer) return;
      if (isVisible) {
        if (typeof layer.addTo === "function") {
          layer.addTo(map);
        } else if (typeof map.addLayer === "function") {
          map.addLayer(layer);
        }
      } else if (typeof map.removeLayer === "function") {
        try {
          map.removeLayer(layer);
        } catch (_) {
          // ignore
        }
      }
    });
  }

  function highlightFeatureOnMap(featureIndex, rowEl) {
    if (!map) initMap();
    if (!map) return;

    const key = String(featureIndex);
    const layers = previewState.featureLayers.get(key) || [];
    if (!layers.length) return;

    let targetLayer = null;
    for (const layer of layers) {
      if (!layer) continue;
      if (typeof layer.getBounds === "function") {
        const b = layer.getBounds();
        if (b && typeof b.getCenter === "function") {
          targetLayer = layer;
          break;
        }
      } else if (typeof layer.getLatLng === "function") {
        targetLayer = layer;
        break;
      }
    }
    if (!targetLayer) {
      targetLayer = layers[0];
    }

    let center = null;
    if (targetLayer && typeof targetLayer.getBounds === "function") {
      const b = targetLayer.getBounds();
      if (b && typeof b.getCenter === "function") {
        center = b.getCenter();
      }
    }
    if (!center && targetLayer && typeof targetLayer.getLatLng === "function") {
      center = targetLayer.getLatLng();
    }
    if (!center) return;

    if (highlightMarker && map && typeof map.removeLayer === "function") {
      try {
        map.removeLayer(highlightMarker);
      } catch (_) {
        // ignore
      }
    }

    highlightMarker = L.circleMarker(center, {
      radius: 10,
      pane: "markerPane",
      interactive: false,
      className: "curation-marker-highlight",
    }).addTo(map);

    if (typeof map.panTo === "function") {
      map.panTo(center);
    }

    const container = featuresContainer();
    if (container) {
      container
        .querySelectorAll(".curation-feature-row.highlighted")
        .forEach((el) => el.classList.remove("highlighted"));
    }
    if (rowEl) {
      rowEl.classList.add("highlighted");
    }

    previewState.highlightFeature(featureIndex);
  }

  async function showPreview(geojson) {
    if (!map) initMap();
    clearPreview();
    const features = geojson?.features || [];
    const bounds = [];
    let basePaths = [];

    const pinkGeojson = await loadPinkLineGeojson();
    if (pinkGeojson && pinkGeojson.features && pinkGeojson.features.length && map) {
      baseRouteLayer = L.geoJSON(pinkGeojson, {
        style: {
          // Match GIS/projection pink-line styling
          color: "#ff69b4",
          weight: 5,
          opacity: 1,
        },
      }).addTo(map);
      baseRouteLayer.eachLayer((l) => {
        if (l.getBounds) bounds.push(l.getBounds());
      });

      try {
        basePaths = parseDefaultLinePaths(pinkGeojson) || [];
      } catch (_) {
        basePaths = [];
      }
    }

    if (!features.length) {
      if (bounds.length && typeof L !== "undefined") {
        map.fitBounds(L.latLngBounds(bounds), { padding: [20, 20] });
      }
      return;
    }

    const userPoints = [];

    features.forEach((feature, index) => {
      const layer = createFeatureLayer(feature);
      if (!layer || !previewState) return;

      previewState.registerFeatureLayers(index, [layer]);

      const enabled = featureEnabled.get(index);
      const visible = enabled !== false;
      setFeatureVisibleOnMap(index, visible);

      if (layer.getBounds) {
        bounds.push(layer.getBounds());
      }

      // Collect point features for integrated pink-line route preview
      const geom = feature.geometry;
      if (geom && geom.type === "Point" && Array.isArray(geom.coordinates)) {
        const [lng, lat] = geom.coordinates;
        if (
          typeof lat === "number" &&
          typeof lng === "number" &&
          Number.isFinite(lat) &&
          Number.isFinite(lng)
        ) {
          userPoints.push([lat, lng]);
        }
      }
    });

    // Add integrated dashed route showing how nodes deviate from the pink line,
    // matching the curated layer behaviour on the GIS / projection views.
    if (
      map &&
      Array.isArray(basePaths) &&
      basePaths.length > 0 &&
      Array.isArray(userPoints) &&
      userPoints.length > 0 &&
      typeof buildIntegratedRoute === "function"
    ) {
      try {
        const { dashed } = buildIntegratedRoute(basePaths, userPoints);
        if (dashed && dashed.length) {
          const layerColor = "#00d4ff";
          const dashedStyle = {
            color: layerColor,
            weight: 5,
            opacity: 0.9,
            dashArray: "10, 10",
          };
          integratedRouteLayer = L.layerGroup();
          dashed.forEach((pts) => {
            integratedRouteLayer.addLayer(L.polyline(pts, dashedStyle));
          });
          integratedRouteLayer.addTo(map);
        }
      } catch (_) {
        // If integrated route fails, fall back to per-feature layers only.
      }
    }

    if (bounds.length && typeof L !== "undefined") {
      const b = L.latLngBounds(bounds);
      map.fitBounds(b, { padding: [24, 24], maxZoom: 16 });
    }
  }

  function setFeatureVisible(index, visible) {
    const layers = featureLayers.get(index);
    if (!layers || !map) return;
    layers.forEach((l) => {
      if (visible) {
        l.addTo(map);
      } else {
        map.removeLayer(l);
      }
    });
    if (highlightedIndex === index && !visible) clearHighlight();
  }

  function highlightFeature(index) {
    clearHighlight();
    if (index < 0 || index >= currentFeatures.length) return;
    if (!featureEnabled.get(index)) return;

    highlightedIndex = index;

    const row = featuresContainer()?.querySelector(`.curation-feature-row:nth-child(${index + 1})`);
    if (row) row.classList.add("highlighted");

    const latlng = getFeatureLatLng(currentFeatures[index]);
    if (latlng && map) {
      highlightMarker = L.marker(latlng, {
        icon: L.divIcon({
          className: "curation-marker-highlight",
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        }),
        interactive: false,
        zIndexOffset: -100,
      }).addTo(map);
      map.panTo(latlng);
    }
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
      publishBtn().disabled = true;
      return;
    }

    currentFeatures.forEach((_, i) => {
      featureEnabled.set(i, true);
    });

    container.innerHTML = currentFeatures
      .map((f, i) => {
        const props = f.properties || {};
        const name =
          props.name ||
          props.description ||
          props.reason ||
          props.id ||
          `Feature ${i + 1}`;
        const subtitle = getSubtitleFromProps(props);
        const id = `curation-f-${i}`;
        const showSubtitle =
          subtitle && String(subtitle).trim() !== String(name).trim();
        const subtitleHtml = showSubtitle
          ? `<div class="curation-feature-meta">${escapeHtml(subtitle)}</div>`
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
            </div>
            <button type="button" class="curation-feature-edit" data-index="${i}" aria-label="Edit feature">Edit</button>
          </div>`;
      })
      .join("");

    container.querySelectorAll("input[data-index]").forEach((input) => {
      input.addEventListener("change", () => {
        const idx = parseInt(input.getAttribute("data-index"), 10);
        featureEnabled.set(idx, input.checked);
        setFeatureVisibleOnMap(idx, input.checked);
        updatePublishState();
      });
    });

    container.querySelectorAll(".curation-feature-row").forEach((row, idx) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("input") || e.target.closest(".curation-feature-edit")) return;
        highlightFeature(idx);
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
        highlightFeatureOnMap(idx, row);
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
      if (opt.value === sid) opt.textContent = getSubmissionDisplayName(sid);
    });
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
    showPreview({ type: "FeatureCollection", features: currentFeatures });
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
    const hasProject = (projectSelect().value || "").trim().length > 0;
    publishBtn().disabled = !hasSelection || !hasName || !hasProject;
  }

  async function loadProjects() {
    try {
      const list = await API.projects();
      const select = projectSelect();
      if (!select) return;
      const current = select.value;
      select.innerHTML =
        '<option value="">— Select project —</option>' +
        (Array.isArray(list) ? list : [])
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
        opt.textContent = getSubmissionDisplayName(id);
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
      await showPreview(geojson);
      renderFeatureList(features);
      setStatus("");
    } catch (e) {
      setStatus("Could not load features: " + e.message, "error");
      renderFeatureList([]);
    }
  }

  function getSelectedProjectName() {
    const sel = projectSelect();
    if (!sel || !sel.value) return "";
    const opt = sel.options[sel.selectedIndex];
    return opt ? opt.textContent.trim() : "";
  }

  async function publish() {
    const name = (layerNameInput().value || "").trim();
    if (!name) {
      setStatus("Enter a layer name.", "error");
      return;
    }

    const projName = getSelectedProjectName();
    if (!projName) {
      setStatus("Select a project first.", "error");
      return;
    }

    const selected = getSelectedGeojson();
    if (!selected.features.length) {
      setStatus("Select at least one feature.", "error");
      return;
    }

    const projectId = (projectSelect().value || "").trim();
    if (!projectId) {
      setStatus("Select a project first.", "error");
      publishBtn().disabled = false;
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
      const effectiveProjectName = result.projectName || projName;
      setStatus(
        "Published as \"" +
          (result.displayName || name) +
          "\" in project \"" +
          effectiveProjectName +
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
    startPolling();

    projectSelect().addEventListener("change", () => {
      const id = projectSelect().value;
      submissionSelect().value = "";
      loadSubmissions(id);
      loadFeatures(null);
      updatePublishState();
    });

    submissionSelect().addEventListener("change", () => {
      loadFeatures(submissionSelect().value);
    });

    layerNameInput().addEventListener("input", updatePublishState);

    publishBtn().addEventListener("click", publish);
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
