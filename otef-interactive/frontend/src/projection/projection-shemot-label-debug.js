/**
 * Development tool: live-edit settlement name label offset/rotate for projector_base.שמות_יישובים,
 * export JSON for `שמות_label_overrides.json` (consumed by the layer processing merge).
 * Toggle: **L** in projection-main (or `window.ShemotLabelDebug.toggle()` for embedded hosts).
 */
const FULL_SOURCE_ID = "projector_base.שמות_יישובים";
const LABEL_LAYER_ID = "projector_base__שמות_יישובים__labels";
const DEFAULT_KEY_FIELD = "citycode";
const DEFAULT_ROTATION_SNAP_DEG = 15;
/** Match projection.html @font-face + map label stack (maplibre-style-bridge שמות). */
const LABEL_MEASURE_FONT_STACK =
  '"Guttman Hatzvi", "Noto Sans Hebrew", "Noto Sans", Arial, sans-serif';
const OTF_ROT = "otef_label_rotate_deg";
const OTF_OX = "otef_label_offset_em_x";
const OTF_OY = "otef_label_offset_em_y";
/** GeoJSON [emX, emY] for MapLibre layout `text-offset` — must match `labels.offsetArrayProperty` in styles. */
const OTF_OFF_ARR = "otef_map_text_offset_em";
/** Default divisor for seed/apply when map text-size is unavailable (matches שמות labels.size). */
const OTF_OFFSET_NUMERATOR_DIV_DEFAULT = 14;
const PANEL_ID = "shemotLabelDebugPanel";
const QUERY_BOX_PX = 5;

/**
 * @param {import("maplibre-gl").Map} map
 * @param {string} sourceId
 * @returns {import("geojson").FeatureCollection | null}
 */
function getGeojsonFeatureCollection(map, sourceId) {
  const src = map.getSource(sourceId);
  if (!src || src.type !== "geojson") return null;
  if (typeof src.serialize === "function") {
    const ser = src.serialize();
    if (ser && ser.data) return deepClone(ser.data);
  }
  if (src._data != null) {
    return typeof src._data === "object" ? deepClone(src._data) : null;
  }
  return null;
}

function deepClone(x) {
  return JSON.parse(JSON.stringify(x));
}

/**
 * @param {import("maplibre-gl").Map} map
 * @returns {number}
 */
function readLabelTextSizeHeuristic(map) {
  if (!map.getLayer || !map.getLayer(LABEL_LAYER_ID)) return 14;
  try {
    const v = map.getLayoutProperty(LABEL_LAYER_ID, "text-size");
    if (typeof v === "number" && v > 0) return v;
  } catch {
    return 14;
  }
  return 14;
}

function propKeyValue(props, keyField) {
  if (!props || typeof props !== "object") return "";
  const raw = props[keyField] ?? props[keyField.toLowerCase?.()] ?? props.CITYCODE;
  if (raw == null) return "";
  return String(raw).trim();
}

function labelTextFromProps(props) {
  if (!props || typeof props !== "object") return "";
  const raw =
    props.cityname ??
    props.CITYNAME ??
    props.CityName ??
    props.TextString ??
    props.text ??
    props.name ??
    "";
  if (raw == null) return "";
  return String(raw).trim();
}

function normalizeRotateDeg(deg) {
  const d = Number(deg);
  if (!Number.isFinite(d)) return 0;
  let x = d % 360;
  if (x < 0) x += 360;
  return x;
}

function snapRotationDeg(deg, stepDeg, disableSnap) {
  if (disableSnap || !stepDeg || stepDeg <= 0) return normalizeRotateDeg(deg);
  const s = snapRotationDegContinuous(normalizeRotateDeg(deg), stepDeg);
  return normalizeRotateDeg(s);
}

/** Snap to nearest step on 0–360 (e.g. 15° grid). */
function snapRotationDegContinuous(deg, step) {
  const d = normalizeRotateDeg(deg);
  const q = Math.round(d / step) * step;
  return normalizeRotateDeg(q);
}

function measureLabelBox(text, fontSizePx) {
  const t = text || "מ";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { width: fontSizePx * 2, height: fontSizePx * 1.2 };
  ctx.font = `${fontSizePx}px ${LABEL_MEASURE_FONT_STACK}`;
  const m = ctx.measureText(t);
  const w = Math.max(8, m.width || fontSizePx);
  const h =
    m.actualBoundingBoxAscent != null && m.actualBoundingBoxDescent != null
      ? m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
      : fontSizePx * 1.15;
  return { width: w, height: Math.max(fontSizePx * 0.9, h) };
}

/**
 * @param {import("geojson").Feature} f
 * @returns {{ lng: number, lat: number } | null}
 */
function featurePointLngLat(f) {
  const g = f?.geometry;
  if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) return null;
  const [lng, lat] = g.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function mapPointToContainerPoint(map, containerEl, mapPoint) {
  if (!map || !containerEl || !mapPoint) return null;
  const mapEl = map.getContainer();
  if (
    !mapEl ||
    typeof mapEl.getBoundingClientRect !== "function" ||
    typeof containerEl.getBoundingClientRect !== "function"
  ) {
    return { x: mapPoint.x, y: mapPoint.y };
  }
  const mr = mapEl.getBoundingClientRect();
  const cr = containerEl.getBoundingClientRect();
  return {
    x: mapPoint.x + (mr.left - cr.left),
    y: mapPoint.y + (mr.top - cr.top),
  };
}

function queryLabelFeaturesNearPoint(map, point) {
  if (!map || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
  const r = QUERY_BOX_PX;
  const box = [
    [point.x - r, point.y - r],
    [point.x + r, point.y + r],
  ];
  try {
    return map.queryRenderedFeatures(box, { layers: [LABEL_LAYER_ID] }) || [];
  } catch {
    return [];
  }
}

function pickNearestLabelFeature(map, feats, point) {
  if (!feats?.length) return null;
  if (feats.length === 1) return feats[0];
  let best = feats[0];
  let bestD = Infinity;
  for (const f of feats) {
    const ll = featurePointLngLat(f);
    if (!ll) continue;
    let p;
    try {
      p = map.project([ll.lng, ll.lat]);
    } catch {
      continue;
    }
    if (!p) continue;
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/**
 * Keys not in the returned map are left without entries (not seeded).
 * @param {import("geojson").FeatureCollection} fc
 * @param {string} [keyField]
 * @returns {Map<string, { rotateDeg: number, offsetEm: [number, number] }>}
 */
export function buildShemotDebugSeedMapFromFeatureCollection(fc, keyField = DEFAULT_KEY_FIELD) {
  const m = new Map();
  if (!fc || !Array.isArray(fc.features)) return m;
  for (const f of fc.features) {
    const p = f.properties && typeof f.properties === "object" ? f.properties : null;
    if (!p) continue;
    const key = propKeyValue(p, keyField);
    if (!key) continue;
    const arr = p[OTF_OFF_ARR];
    const hasArrayOffset =
      Array.isArray(arr) &&
      arr.length >= 2 &&
      (Number(arr[0]) !== 0 || Number(arr[1]) !== 0);
    if (p[OTF_ROT] == null && p[OTF_OX] == null && p[OTF_OY] == null && !hasArrayOffset) continue;
    const rot = p[OTF_ROT];
    const oxe = p[OTF_OX];
    const oye = p[OTF_OY];
    const rd = rot != null && Number.isFinite(Number(rot)) ? normalizeRotateDeg(Number(rot)) : 0;
    const hasScalarOx = oxe != null && Number.isFinite(Number(oxe));
    const hasScalarOy = oye != null && Number.isFinite(Number(oye));
    let ox = hasScalarOx ? Number(oxe) : 0;
    let oy = hasScalarOy ? Number(oye) : 0;
    if (!hasScalarOx && !hasScalarOy && hasArrayOffset) {
      const d = OTF_OFFSET_NUMERATOR_DIV_DEFAULT;
      ox = Number(arr[0]) * d;
      oy = Number(arr[1]) * d;
    }
    m.set(key, { rotateDeg: rd, offsetEm: [ox, oy] });
  }
  return m;
}

/**
 * Merges override entries; keys not in `overrides` keep existing otef_* (no delete).
 * @param {import("geojson").FeatureCollection} fc
 * @param {Map<string, { rotateDeg?: number, offsetEm?: number[] }>} overrides
 * @param {string} [keyField]
 * @returns {import("geojson").FeatureCollection}
 */
export function applyShemotDebugOverridesToFeatureCollection(fc, overrides, keyField = DEFAULT_KEY_FIELD) {
  if (!fc || !Array.isArray(fc.features)) return fc;
  for (const f of fc.features) {
    const p = f.properties && typeof f.properties === "object" ? f.properties : {};
    const key = propKeyValue(p, keyField);
    if (!key) continue;
    if (!overrides.has(key)) {
      f.properties = p;
      continue;
    }
    const e = overrides.get(key) || {};
    const rot = e.rotateDeg;
    const rd = rot != null && Number.isFinite(Number(rot)) ? normalizeRotateDeg(Number(rot)) : 0;
    const ox = Array.isArray(e.offsetEm) ? Number(e.offsetEm[0]) || 0 : 0;
    const oy = Array.isArray(e.offsetEm) ? Number(e.offsetEm[1]) || 0 : 0;
    p[OTF_ROT] = rd;
    p[OTF_OX] = ox;
    p[OTF_OY] = oy;
    const div = OTF_OFFSET_NUMERATOR_DIV_DEFAULT;
    p[OTF_OFF_ARR] = [ox / div, oy / div];
    f.properties = p;
  }
  return fc;
}

/**
 * @param {{
 *   map: import("maplibre-gl").Map;
 *   registerDisposer: (fn: () => void) => void;
 *   keyField?: string;
 *   rotationSnapDeg?: number;
 * }} opts
 * @returns {{
 *   toggle: () => void;
 *   setVisible: (v: boolean) => void;
 *   getActive: () => boolean;
 *   dispose: () => void;
 * } | null}
 */
export function installShemotLabelDebug(opts) {
  const map = opts?.map;
  const registerDisposer = opts?.registerDisposer;
  if (!map || typeof registerDisposer !== "function") return null;
  const keyField = (opts.keyField && String(opts.keyField).trim()) || DEFAULT_KEY_FIELD;
  const snapStep =
    typeof opts.rotationSnapDeg === "number" && Number.isFinite(opts.rotationSnapDeg) && opts.rotationSnapDeg > 0
      ? opts.rotationSnapDeg
      : DEFAULT_ROTATION_SNAP_DEG;

  const overrides = new Map();
  let selectedKey = "";
  /** @type {{ lng: number, lat: number } | null} */
  let selectedAnchorLngLat = null;
  let selectedLabelText = "";
  let active = false;
  const undoStack = [];
  const redoStack = [];
  let ignoreClickAfterDrag = false;
  let dragDidMove = false;

  /** @type {"move" | "rotate" | null} */
  let dragMode = null;
  let lastPoint = null;
  /** @type {number | null} */
  let rotateStartMouseAngle = null;
  /** @type {number | null} */
  let rotateBaseDeg = null;
  let rotateShiftSnapOff = false;

  const displayContainer =
    (typeof document !== "undefined" && document.getElementById("displayContainer")) || document.body;

  let bboxLayer =
    typeof document !== "undefined" ? document.getElementById("shemotLabelBBoxLayer") : null;
  if (displayContainer && (!bboxLayer || !bboxLayer.isConnected)) {
    bboxLayer = document.createElement("div");
    bboxLayer.id = "shemotLabelBBoxLayer";
    bboxLayer.setAttribute("aria-hidden", "true");
    displayContainer.appendChild(bboxLayer);
  }

  const selBox = document.createElement("div");
  selBox.className = "shemot-label-sel-box";
  selBox.style.cssText = [
    "position:absolute",
    "display:none",
    "box-sizing:border-box",
    "border:2px solid #0ff",
    "background:rgba(0,255,255,0.06)",
    "pointer-events:auto",
    "cursor:move",
    "transform-origin:50% 50%",
    "touch-action:none",
  ].join(";");
  bboxLayer?.appendChild(selBox);

  const HANDLE = 11;
  const makeHandle = (corner, cursor, isRotate) => {
    const h = document.createElement("div");
    h.className = `shemot-label-handle shemot-label-handle-${corner}`;
    h.dataset.corner = corner;
    h.style.cssText = [
      "position:absolute",
      "width:" + HANDLE + "px",
      "height:" + HANDLE + "px",
      "marginLeft:-" + HANDLE / 2 + "px",
      "marginTop:-" + HANDLE / 2 + "px",
      "background:#0ff",
      "border:1px solid #036",
      "box-sizing:border-box",
      "pointer-events:auto",
      "cursor:" + cursor,
      "touch-action:none",
    ].join(";");
    if (isRotate) h.dataset.role = "rotate";
    selBox.appendChild(h);
    return h;
  };

  const handleTL = makeHandle("tl", "nwse-resize", false);
  const handleTR = makeHandle("tr", "nesw-resize", false);
  const handleBL = makeHandle("bl", "nesw-resize", false);
  const handleBR = makeHandle("br", "grab", true);
  for (const h of [handleTL, handleTR, handleBL, handleBR]) {
    h.style.opacity = "0.85";
  }

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "שמות label debug");
  panel.style.cssText = [
    "position:fixed",
    "top:10px",
    "right:10px",
    "z-index:130",
    "max-width:340px",
    "background:rgba(0,0,0,0.9)",
    "color:#fff",
    "font:13px/1.35 Arial,sans-serif",
    "padding:10px 12px",
    "border-radius:6px",
    "display:none",
    "box-shadow:0 2px 10px rgba(0,0,0,0.4)",
  ].join(";");
  panel.innerHTML = [
    "<strong style=\"color:#0ff\">שמות label debug</strong>",
    "<p style=\"margin:8px 0 0;font-size:12px;color:#ccc\">",
    "Click a label to select. Drag the box to move (offset). Drag the <strong>bottom-right</strong> handle to rotate — snaps every ",
    String(snapStep),
    "° (hold <strong>Shift</strong> for free rotation). Keys: arrows nudge; [ ] rotate ±",
    String(snapStep),
    "°. <strong>Reset</strong> clears merged otef_* on the map for the selection or all features.",
    "</p>",
    "<p id=\"shemotDebugStatus\" style=\"margin:6px 0 0;font-size:12px;color:#9cf\">Mode off — press L to enable.</p>",
    "<div style=\"margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center\">",
    "<button type=\"button\" id=\"shemotDbgRotMinus\" style=\"padding:4px 8px;cursor:pointer\">Rotate −",
    String(snapStep),
    "°</button>",
    "<button type=\"button\" id=\"shemotDbgRotPlus\" style=\"padding:4px 8px;cursor:pointer\">Rotate +",
    String(snapStep),
    "°</button>",
    "<button type=\"button\" id=\"shemotDbgUndo\" style=\"padding:4px 8px;cursor:pointer\">Undo</button>",
    "<button type=\"button\" id=\"shemotDbgRedo\" style=\"padding:4px 8px;cursor:pointer\">Redo</button>",
    "<button type=\"button\" id=\"shemotDbgResetSel\" class=\"shemot-dbg-secondary\" style=\"padding:4px 8px;cursor:pointer;background:#555;border:none;color:#fff;border-radius:3px\">Reset selected</button>",
    "<button type=\"button\" id=\"shemotDbgResetAll\" style=\"padding:4px 8px;cursor:pointer;background:#555;border:none;color:#fff;border-radius:3px\">Reset all</button>",
    "<button type=\"button\" id=\"shemotDbgDownload\" style=\"padding:4px 8px;cursor:pointer;background:#0a8;border:none;color:#fff;border-radius:3px\">Download JSON</button>",
    "</div>",
  ].join("");

  if (document.body) {
    document.body.appendChild(panel);
  }

  const statusEl = () => document.getElementById("shemotDebugStatus");
  const pushUndo = () => {
    undoStack.push(serializeOverrides());
    redoStack.length = 0;
  };

  const serializeOverrides = () =>
    JSON.stringify(
      Object.fromEntries(
        [...overrides.entries()]
          .filter(([, v]) => v && typeof v === "object")
          .sort((a, b) => a[0].localeCompare(b[0])),
      ),
    );

  const loadOverridesFromJson = (json) => {
    let o;
    try {
      o = JSON.parse(json);
    } catch {
      return;
    }
    overrides.clear();
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object") overrides.set(String(k), { ...v });
    }
  };

  /** `offsetEm` in JSON matches GeoJSON numerators + otef_map_text_offset_em [x/size, y/size] for MapLibre text-offset. */
  const getEntryForKey = (k) => {
    if (!k) {
      return { rotateDeg: 0, offsetEm: [0, 0] };
    }
    if (overrides.has(k)) {
      const e = overrides.get(k);
      return {
        rotateDeg: normalizeRotateDeg(e.rotateDeg),
        offsetEm: [
          Array.isArray(e.offsetEm) ? Number(e.offsetEm[0]) || 0 : 0,
          Array.isArray(e.offsetEm) ? Number(e.offsetEm[1]) || 0 : 0,
        ],
      };
    }
    return { rotateDeg: 0, offsetEm: [0, 0] };
  };

  const seedOverridesFromCurrentSource = () => {
    const fc = getGeojsonFeatureCollection(map, FULL_SOURCE_ID);
    if (!fc) return;
    const m = buildShemotDebugSeedMapFromFeatureCollection(fc, keyField);
    for (const [k, v] of m) {
      if (!overrides.has(k)) {
        overrides.set(k, v);
      }
    }
  };

  const stripOtefFromProps = (p) => {
    if (!p || typeof p !== "object") return;
    delete p[OTF_ROT];
    delete p[OTF_OX];
    delete p[OTF_OY];
    delete p[OTF_OFF_ARR];
  };

  const pushOtefDataToMap = (fc) => {
    const src = map.getSource(FULL_SOURCE_ID);
    if (src && typeof src.setData === "function") {
      src.setData(fc);
    }
    if (typeof map.triggerRepaint === "function") {
      try {
        map.triggerRepaint();
      } catch {
        /* optional */
      }
    }
  };

  /** Only way to remove merged otef_* from the live source (Reset selected / Reset all). */
  const stripOtefFromSourceForSingleKey = (targetKey) => {
    if (!targetKey) return;
    const fc = getGeojsonFeatureCollection(map, FULL_SOURCE_ID);
    if (!fc || !Array.isArray(fc.features)) return;
    for (const f of fc.features) {
      const p = f.properties && typeof f.properties === "object" ? f.properties : null;
      if (!p) continue;
      if (propKeyValue(p, keyField) !== targetKey) continue;
      stripOtefFromProps(p);
    }
    pushOtefDataToMap(fc);
    updateSelectionOverlay();
  };

  const stripOtefFromSourceAllKeys = () => {
    const fc = getGeojsonFeatureCollection(map, FULL_SOURCE_ID);
    if (!fc || !Array.isArray(fc.features)) return;
    for (const f of fc.features) {
      const p = f.properties && typeof f.properties === "object" ? f.properties : null;
      if (p) stripOtefFromProps(p);
    }
    pushOtefDataToMap(fc);
    updateSelectionOverlay();
  };

  /** Batched to one frame during drag; bbox/status use live `overrides` and update every move. */
  let applyRaf = null;
  const scheduleApplyOverridesToSourceData = () => {
    if (applyRaf != null) return;
    applyRaf = requestAnimationFrame(() => {
      applyRaf = null;
      applyOverridesToSourceData();
    });
  };

  const applyOverridesToSourceData = () => {
    const fc = getGeojsonFeatureCollection(map, FULL_SOURCE_ID);
    if (!fc || !Array.isArray(fc.features)) return;
    const ts = readLabelTextSizeHeuristic(map);
    for (const f of fc.features) {
      const p = f.properties && typeof f.properties === "object" ? f.properties : {};
      const key = propKeyValue(p, keyField);
      if (!key) continue;
      if (!overrides.has(key)) {
        f.properties = p;
        continue;
      }
      const e = getEntryForKey(key);
      p[OTF_ROT] = normalizeRotateDeg(e.rotateDeg);
      p[OTF_OX] = e.offsetEm[0] || 0;
      p[OTF_OY] = e.offsetEm[1] || 0;
      const div = ts > 0 ? ts : OTF_OFFSET_NUMERATOR_DIV_DEFAULT;
      p[OTF_OFF_ARR] = [(p[OTF_OX] || 0) / div, (p[OTF_OY] || 0) / div];
      f.properties = p;
    }
    pushOtefDataToMap(fc);
    updateSelectionOverlay();
  };

  function updateSelectionOverlay() {
    if (!bboxLayer || !selBox || !active || !selectedKey || !selectedAnchorLngLat) {
      if (selBox) selBox.style.display = "none";
      return;
    }
    const ts = readLabelTextSizeHeuristic(map);
    const e = getEntryForKey(selectedKey);
    const ox = e.offsetEm[0] || 0;
    const oy = e.offsetEm[1] || 0;
    const rot = normalizeRotateDeg(e.rotateDeg);

    let anchorPx;
    try {
      anchorPx = map.project([selectedAnchorLngLat.lng, selectedAnchorLngLat.lat]);
    } catch {
      selBox.style.display = "none";
      return;
    }
    const ctr = mapPointToContainerPoint(map, displayContainer, {
      x: anchorPx.x + ox,
      y: anchorPx.y + oy,
    });
    if (!ctr) {
      selBox.style.display = "none";
      return;
    }

    const { width: bw, height: bh } = measureLabelBox(selectedLabelText, ts);
    const pad = HANDLE / 2 + 2;
    selBox.style.display = "block";
    selBox.style.left = `${ctr.x - bw / 2}px`;
    selBox.style.top = `${ctr.y - bh / 2}px`;
    selBox.style.width = `${bw}px`;
    selBox.style.height = `${bh}px`;
    selBox.style.transform = `rotate(${rot}deg)`;

    handleTL.style.left = `${pad}px`;
    handleTL.style.top = `${pad}px`;
    handleTR.style.left = `${bw - pad}px`;
    handleTR.style.top = `${pad}px`;
    handleBL.style.left = `${pad}px`;
    handleBL.style.top = `${bh - pad}px`;
    handleBR.style.left = `${bw - pad}px`;
    handleBR.style.top = `${bh - pad}px`;
  }

  const updateStatus = () => {
    const s = statusEl();
    if (!s) return;
    if (!active) {
      s.textContent = "Mode off — press L to enable.";
      return;
    }
    const k = selectedKey || "(none)";
    const e = getEntryForKey(selectedKey);
    const ex = e.offsetEm[0] || 0;
    const ey = e.offsetEm[1] || 0;
    s.textContent = `On — keyField ${keyField} — selected: ${k} | rotate ${normalizeRotateDeg(
      e.rotateDeg,
    ).toFixed(1)}° | offset (px) [${ex.toFixed(1)}, ${ey.toFixed(1)}]`;
  };

  const setVisible = (v) => {
    const next = !!v;
    if (active === next) {
      if (next) {
        if (document.body) document.body.classList.add("shemot-label-debug-active");
        panel.style.display = "block";
        bboxLayer && (bboxLayer.style.display = "");
        updateStatus();
        applyOverridesToSourceData();
      }
      return;
    }
    active = next;
    if (active) {
      if (document.body) document.body.classList.add("shemot-label-debug-active");
      panel.style.display = "block";
      if (bboxLayer) bboxLayer.style.display = "";
      seedOverridesFromCurrentSource();
    } else {
      if (document.body) document.body.classList.remove("shemot-label-debug-active");
      panel.style.display = "none";
      dragMode = null;
      lastPoint = null;
      if (applyRaf != null) {
        cancelAnimationFrame(applyRaf);
        applyRaf = null;
      }
      if (bboxLayer) {
        bboxLayer.style.display = "none";
      }
      selBox.style.display = "none";
    }
    updateStatus();
    if (active) {
      applyOverridesToSourceData();
    }
  };

  const toggleActive = () => setVisible(!active);

  const onMapClick = (e) => {
    if (!active) return;
    if (ignoreClickAfterDrag) {
      ignoreClickAfterDrag = false;
      return;
    }
    if (!e?.point) return;
    if (!map.getLayer || !map.getLayer(LABEL_LAYER_ID)) return;
    const feats = queryLabelFeaturesNearPoint(map, e.point);
    const f = pickNearestLabelFeature(map, feats, e.point);
    if (!f || !f.properties) {
      selectedKey = "";
      selectedAnchorLngLat = null;
      selectedLabelText = "";
      updateStatus();
      updateSelectionOverlay();
      return;
    }
    const key = propKeyValue(f.properties, keyField);
    selectedKey = key || "";
    selectedAnchorLngLat = featurePointLngLat(f);
    selectedLabelText = labelTextFromProps(f.properties);
    if (selectedKey && !overrides.has(selectedKey)) {
      const rot = f.properties[OTF_ROT];
      const oxe = f.properties[OTF_OX];
      const oye = f.properties[OTF_OY];
      const rd = rot != null && Number.isFinite(Number(rot)) ? normalizeRotateDeg(Number(rot)) : 0;
      const ox = oxe != null && Number.isFinite(Number(oxe)) ? Number(oxe) : 0;
      const oy = oye != null && Number.isFinite(Number(oye)) ? Number(oye) : 0;
      if (rd !== 0 || ox !== 0 || oy !== 0) {
        overrides.set(selectedKey, { rotateDeg: rd, offsetEm: [ox, oy] });
      }
    }
    updateStatus();
    updateSelectionOverlay();
  };

  const onSelMouseDown = (ev) => {
    if (!active || !selectedKey) return;
    const t = ev.target;
    if (t === handleTL || t === handleTR || t === handleBL) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    const isRotate = t === handleBR || (t && t.dataset && t.dataset.role === "rotate");
    pushUndo();
    dragDidMove = false;
    dragMode = isRotate ? "rotate" : "move";
    lastPoint = { x: ev.clientX, y: ev.clientY };
    if (isRotate) {
      const e = getEntryForKey(selectedKey);
      rotateBaseDeg = normalizeRotateDeg(e.rotateDeg);
      rotateShiftSnapOff = !!ev.shiftKey;
      const rect = selBox.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      rotateStartMouseAngle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
    } else {
      rotateStartMouseAngle = null;
      rotateBaseDeg = null;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (isRotate) {
      handleBR.style.cursor = "grabbing";
    }
  };

  const onDocumentMouseMove = (ev) => {
    if (!active || !dragMode || !selectedKey) return;
    if (dragMode === "move") {
      if (!lastPoint) return;
      const ddx = ev.clientX - lastPoint.x;
      const ddy = ev.clientY - lastPoint.y;
      if (Math.abs(ddx) > 0.5 || Math.abs(ddy) > 0.5) dragDidMove = true;
      lastPoint = { x: ev.clientX, y: ev.clientY };
      const cur = getEntryForKey(selectedKey);
      if (!overrides.has(selectedKey)) {
        overrides.set(selectedKey, { rotateDeg: normalizeRotateDeg(cur.rotateDeg), offsetEm: [0, 0] });
      }
      const base = getEntryForKey(selectedKey);
      // Stored otef_* are numerators before buildLabelTextOffset divides by labels.size (bbox uses same numbers as px shift from anchor).
      const o0 = (base.offsetEm[0] || 0) + ddx;
      const o1 = (base.offsetEm[1] || 0) + ddy;
      overrides.set(selectedKey, {
        rotateDeg: normalizeRotateDeg(base.rotateDeg),
        offsetEm: [o0, o1],
      });
      scheduleApplyOverridesToSourceData();
      updateStatus();
      updateSelectionOverlay();
      return;
    }
    if (dragMode === "rotate") {
      if (rotateStartMouseAngle == null || rotateBaseDeg == null) return;
      rotateShiftSnapOff = !!ev.shiftKey;
      const rect = selBox.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let deltaDeg = ((ang - rotateStartMouseAngle) * 180) / Math.PI;
      let next = rotateBaseDeg + deltaDeg;
      next = snapRotationDeg(next, snapStep, rotateShiftSnapOff);
      if (Math.abs(deltaDeg) > 0.01) dragDidMove = true;
      if (!overrides.has(selectedKey)) {
        overrides.set(selectedKey, { rotateDeg: normalizeRotateDeg(rotateBaseDeg), offsetEm: [0, 0] });
      }
      const base = getEntryForKey(selectedKey);
      overrides.set(selectedKey, {
        rotateDeg: next,
        offsetEm: [base.offsetEm[0] || 0, base.offsetEm[1] || 0],
      });
      scheduleApplyOverridesToSourceData();
      updateStatus();
      updateSelectionOverlay();
    }
  };

  const onDocumentMouseUp = () => {
    if (!dragMode) return;
    if (applyRaf != null) {
      cancelAnimationFrame(applyRaf);
      applyRaf = null;
      applyOverridesToSourceData();
    }
    if (dragDidMove) ignoreClickAfterDrag = true;
    dragMode = null;
    lastPoint = null;
    rotateStartMouseAngle = null;
    rotateBaseDeg = null;
    handleBR.style.cursor = "grab";
  };

  const onKeyDown = (ev) => {
    if (!active || !selectedKey) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      ev.preventDefault();
      pushUndo();
      const step = ev.shiftKey ? 5 : 1;
      const cur = getEntryForKey(selectedKey);
      if (!overrides.has(selectedKey)) {
        overrides.set(selectedKey, { rotateDeg: normalizeRotateDeg(cur.rotateDeg), offsetEm: [0, 0] });
      }
      const base = getEntryForKey(selectedKey);
      let dx = 0;
      let dy = 0;
      if (k === "ArrowLeft") dx = -step;
      if (k === "ArrowRight") dx = step;
      if (k === "ArrowUp") dy = -step;
      if (k === "ArrowDown") dy = step;
      overrides.set(selectedKey, {
        rotateDeg: normalizeRotateDeg(base.rotateDeg),
        offsetEm: [(base.offsetEm[0] || 0) + dx, (base.offsetEm[1] || 0) + dy],
      });
      applyOverridesToSourceData();
      updateStatus();
      return;
    }
    if (k === "[" || k === "]") {
      ev.preventDefault();
      pushUndo();
      const delta = k === "[" ? -snapStep : snapStep;
      const cur = getEntryForKey(selectedKey);
      if (!overrides.has(selectedKey)) {
        overrides.set(selectedKey, { rotateDeg: normalizeRotateDeg(cur.rotateDeg), offsetEm: [0, 0] });
      }
      const base = getEntryForKey(selectedKey);
      overrides.set(selectedKey, {
        rotateDeg: normalizeRotateDeg(normalizeRotateDeg(base.rotateDeg) + delta),
        offsetEm: [base.offsetEm[0] || 0, base.offsetEm[1] || 0],
      });
      applyOverridesToSourceData();
      updateStatus();
    }
  };

  const wirePanel = () => {
    const rotMinus = document.getElementById("shemotDbgRotMinus");
    const rotPlus = document.getElementById("shemotDbgRotPlus");
    const undoBtn = document.getElementById("shemotDbgUndo");
    const redoBtn = document.getElementById("shemotDbgRedo");
    const resetSel = document.getElementById("shemotDbgResetSel");
    const resetAll = document.getElementById("shemotDbgResetAll");
    const dl = document.getElementById("shemotDbgDownload");
    const nudgeRot = (delta) => {
      if (!selectedKey) {
        updateStatus();
        return;
      }
      pushUndo();
      const cur = getEntryForKey(selectedKey);
      if (!overrides.has(selectedKey)) {
        overrides.set(selectedKey, { rotateDeg: normalizeRotateDeg(cur.rotateDeg), offsetEm: [0, 0] });
      }
      const base = getEntryForKey(selectedKey);
      overrides.set(selectedKey, {
        rotateDeg: normalizeRotateDeg(normalizeRotateDeg(base.rotateDeg) + delta),
        offsetEm: [base.offsetEm[0] || 0, base.offsetEm[1] || 0],
      });
      applyOverridesToSourceData();
      updateStatus();
    };
    if (rotMinus) rotMinus.onclick = () => nudgeRot(-snapStep);
    if (rotPlus) rotPlus.onclick = () => nudgeRot(snapStep);
    if (undoBtn) {
      undoBtn.onclick = () => {
        if (undoStack.length === 0) return;
        redoStack.push(serializeOverrides());
        loadOverridesFromJson(undoStack.pop());
        applyOverridesToSourceData();
        updateStatus();
      };
    }
    if (redoBtn) {
      redoBtn.onclick = () => {
        if (redoStack.length === 0) return;
        undoStack.push(serializeOverrides());
        loadOverridesFromJson(redoStack.pop());
        applyOverridesToSourceData();
        updateStatus();
      };
    }
    if (resetSel) {
      resetSel.onclick = () => {
        if (!selectedKey) return;
        pushUndo();
        const k = selectedKey;
        overrides.delete(k);
        stripOtefFromSourceForSingleKey(k);
        updateStatus();
      };
    }
    if (resetAll) {
      resetAll.onclick = () => {
        pushUndo();
        overrides.clear();
        selectedKey = "";
        selectedAnchorLngLat = null;
        selectedLabelText = "";
        stripOtefFromSourceAllKeys();
        updateStatus();
      };
    }
    if (dl) {
      dl.onclick = () => {
        const out = {
          version: 1,
          keyField,
          overrides: Object.fromEntries(overrides),
        };
        const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "שמות_label_overrides.json";
        a.click();
        URL.revokeObjectURL(a.href);
      };
    }
  };
  wirePanel();

  const onViewportChange = () => {
    updateSelectionOverlay();
  };

  map.on("click", onMapClick);
  for (const ev of ["moveend", "zoomend", "rotateend", "pitchend", "resize"]) {
    map.on(ev, onViewportChange);
  }

  selBox.addEventListener("mousedown", onSelMouseDown, true);
  document.addEventListener("mousemove", onDocumentMouseMove, true);
  document.addEventListener("mouseup", onDocumentMouseUp, true);
  window.addEventListener("keydown", onKeyDown, true);

  const dispose = () => {
    setVisible(false);
    if (map.off) {
      map.off("click", onMapClick);
      for (const ev of ["moveend", "zoomend", "rotateend", "pitchend", "resize"]) {
        map.off(ev, onViewportChange);
      }
    }
    selBox.removeEventListener("mousedown", onSelMouseDown, true);
    document.removeEventListener("mousemove", onDocumentMouseMove, true);
    document.removeEventListener("mouseup", onDocumentMouseUp, true);
    window.removeEventListener("keydown", onKeyDown, true);
    if (document.body) {
      document.body.classList.remove("shemot-label-debug-active");
    }
    selBox.remove();
    panel.remove();
  };

  registerDisposer(dispose);

  return {
    toggle: () => {
      if (active) {
        toggleActive();
        return;
      }
      if (!map.getSource || !map.getSource(FULL_SOURCE_ID)) {
        if (statusEl()) {
          statusEl().textContent = `No source ${FULL_SOURCE_ID} on map (enable שמות_יישובים layer).`;
        }
        console.warn(`[ShemotLabelDebug] Missing GeoJSON source ${FULL_SOURCE_ID}`);
        return;
      }
      toggleActive();
    },
    setVisible,
    getActive: () => active,
    dispose,
  };
}
