/**
 * Curation page: list Supabase projects/submissions, Leaflet preview with
 * pink line (הקו_הורוד) base route, submission features as dashed lines and
 * labeled points. Toggle features, name and publish as OTEF layer.
 * Uses API proxy only (no Supabase client on frontend).
 */

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
  let baseRouteLayer = null;
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
    if (currentLayer && map) {
      map.removeLayer(currentLayer);
      currentLayer = null;
    }
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

  function getGeometryType(geometry) {
    if (!geometry || !geometry.type) return null;
    const t = geometry.type.toLowerCase();
    if (t === "point" || t === "multipoint") return "point";
    if (t === "linestring" || t === "multilinestring") return "line";
    return "polygon";
  }

  async function showPreview(geojson) {
    if (!map) initMap();
    clearPreview();
    const features = geojson?.features || [];
    const bounds = [];

    const pinkGeojson = await loadPinkLineGeojson();
    if (pinkGeojson && pinkGeojson.features && pinkGeojson.features.length && map) {
      baseRouteLayer = L.geoJSON(pinkGeojson, {
        style: {
          color: "#ff7f7f",
          weight: 3,
          opacity: 0.9,
        },
      }).addTo(map);
      baseRouteLayer.eachLayer((l) => {
        if (l.getBounds) bounds.push(l.getBounds());
      });
    }

    if (!features.length) {
      if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [20, 20] });
      return;
    }

    const pointFeatures = [];
    const lineFeatures = [];
    const otherFeatures = [];
    features.forEach((f) => {
      const geomType = getGeometryType(f.geometry);
      if (geomType === "point") pointFeatures.push(f);
      else if (geomType === "line") lineFeatures.push(f);
      else otherFeatures.push(f);
    });

    currentLayer = L.layerGroup();

    const pointLayer = L.geoJSON(
      { type: "FeatureCollection", features: pointFeatures },
      {
        pointToLayer: (feature, latlng) => {
          const ft = feature.properties && feature.properties.feature_type;
          const memorialIcon = ft && MEMORIAL_ICONS[ft];
          if (memorialIcon) {
            return L.marker(latlng, {
              icon: L.icon({
                iconUrl: memorialIcon,
                iconSize: [36, 36],
                iconAnchor: [18, 18],
                popupAnchor: [0, -18],
              }),
            });
          }
          const label = getLabelFromProps(feature.properties);
          return L.marker(latlng, {
            icon: L.divIcon({
              className: "leaflet-label-icon",
              html: label
                ? '<span class="curation-marker-label">' + escapeHtml(label) + "</span>"
                : "<span class=\"curation-marker-label\">•</span>",
              iconSize: null,
              iconAnchor: [0, 0],
            }),
          });
        },
      }
    );
    pointLayer.eachLayer((l) => {
      currentLayer.addLayer(l);
      if (l.getBounds) bounds.push(l.getBounds());
    });

    const lineStyle = { color: "#00d4ff", weight: 2.5, dashArray: "8,6", opacity: 0.95 };
    const lineLayer = L.geoJSON(
      { type: "FeatureCollection", features: lineFeatures },
      { style: lineStyle }
    );
    lineLayer.eachLayer((l) => {
      currentLayer.addLayer(l);
      if (l.getBounds) bounds.push(l.getBounds());
    });

    const otherStyle = { color: "#00d4ff", weight: 2, fillOpacity: 0.3 };
    const otherLayer = L.geoJSON(
      { type: "FeatureCollection", features: otherFeatures },
      { style: otherStyle }
    );
    otherLayer.eachLayer((l) => {
      currentLayer.addLayer(l);
      if (l.getBounds) bounds.push(l.getBounds());
    });

    currentLayer.addTo(map);
    if (bounds.length) {
      const b = L.latLngBounds(bounds);
      map.fitBounds(b, { padding: [24, 24], maxZoom: 16 });
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
        const showSubtitle = subtitle && String(subtitle).trim() !== String(name).trim();
        const subtitleHtml = showSubtitle
          ? `<div class="curation-feature-meta">${escapeHtml(subtitle)}</div>`
          : "";
        const ft = props.feature_type;
        const memorialIcon = ft && MEMORIAL_ICONS[ft];
        const iconHtml = memorialIcon
          ? `<img src="${memorialIcon}" alt="" style="width:20px;height:20px;margin-top:2px;flex-shrink:0;" />`
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
        updatePublishState();
      });
    });

    container.querySelectorAll(".curation-feature-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-index"), 10);
        openFeatureModal(idx);
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
    startPolling();

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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
