/**
 * Zikim / sea crop UV measurement (Task 12).
 *
 * Catalog from spec (verbatim):
 *   Zikim ITM (154669.92, 613156.77)
 *   Zikim WGS84 (34.5218, 31.6090)
 * West point is 2.5 km west of Zikim (ITM easting minus 2500 m).
 *
 * Live MapLibre `project()` UV cannot be faked in Node. This script prints
 * catalog points, committed `getProjectionSpanRect("right")` / `"left"`, and
 * converts operator-supplied span-viewport UV to T3 UV before classifying it
 * with `uvInsideSpanRect`. It never invents Tesuga or UV numbers and does not
 * edit `PROJECTION_SPAN` or model-bounds.
 *
 * From `otef-interactive` (Node must treat frontend `.js` as ESM):
 *
 *   node --experimental-detect-module scripts/measure-zikim-span-uv.mjs
 *   node --experimental-detect-module scripts/measure-zikim-span-uv.mjs --span right --uv-zikim u,v --uv-west u,v
 *
 * Lab (required for measured cells in `docs/nli-exhibit-verification.md`):
 *
 *   1. Open projection.html?span=right. Wait until Tesuga span camera is idle
 *      (`applyProjectionSpanView` after map load / fitBounds).
 *   2. In that projection page's console, use `window._maplibreMap`. It is the
 *      live MapLibre map that `applyProjectionSpanView` received.
 *   3. Project with the live map, then convert container pixels to UV:
 *
 *        function spanViewportUv(lngLat) {
 *          const map = window._maplibreMap;
 *          const p = map.project([lngLat.lng, lngLat.lat]);
 *          const el = map.getContainer();
 *          return { u: p.x / el.clientWidth, v: p.y / el.clientHeight };
 *        }
 *
 *      Use the Zikim and west WGS84 printed below. Record span-viewport u,v —
 *      do not guess. The script computes post-Tesuga T3 UV with
 *      `spanViewportUvToT3Uv(uv, getProjectionSpanRect(spanId))`.
 *   4. Classify:
 *
 *        node --experimental-detect-module scripts/measure-zikim-span-uv.mjs \
 *          --span right --uv-zikim <viewport-u>,<viewport-v> \
 *          --uv-west <viewport-u>,<viewport-v>
 *
 *      The script prints both supplied viewport UV and computed T3 UV, then
 *      compares T3 UV to both span rects. Repeat steps 1–4 on
 *      projection.html?span=left with `--span left`.
 *   5. Attach screenshots/notes of both span pages. Compare the older
 *      full-span TouchDesigner file as control (does that file still show the
 *      coast?). Write paths and pass/pending into the verification table.
 */

import proj4 from "proj4";
import {
  getProjectionSpanRect,
  spanViewportUvToT3Uv,
  uvInsideSpanRect,
} from "../frontend/src/projection/projection-span-view.js";

const WEST_SHIFT_M = 2500;

/** Spec catalog — do not replace with generated-catalog extra digits. */
const ZIKIM_ITM = { x: 154669.92, y: 613156.77 };
const ZIKIM_WGS84 = { lng: 34.5218, lat: 31.6090 };

const ISRAEL_TM_GRID =
  "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs";

proj4.defs("EPSG:2039", ISRAEL_TM_GRID);

const WEST_ITM = { x: ZIKIM_ITM.x - WEST_SHIFT_M, y: ZIKIM_ITM.y };
const westWgs = proj4("EPSG:2039", "EPSG:4326", [WEST_ITM.x, WEST_ITM.y]);
const WEST_WGS84 = { lng: westWgs[0], lat: westWgs[1] };

function parseUvFlag(argv, name) {
  const idx = argv.indexOf(name);
  if (idx < 0) return null;
  const raw = argv[idx + 1];
  if (raw == null || raw.startsWith("--")) {
    throw new Error(`${name} expects u,v`);
  }
  const parts = String(raw).split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || !parts.every(Number.isFinite)) {
    throw new Error(`${name} expects finite u,v (got ${JSON.stringify(raw)})`);
  }
  return { u: parts[0], v: parts[1] };
}

function parseSpanFlag(argv) {
  const idx = argv.indexOf("--span");
  if (idx < 0) return null;
  const spanId = String(argv[idx + 1] ?? "").trim().toLowerCase();
  if (spanId !== "left" && spanId !== "right") {
    throw new Error("--span expects right or left");
  }
  return spanId;
}

function classify(label, viewportUv, sourceRect) {
  if (!viewportUv) {
    return {
      label,
      viewportUv: "pending (live map.project() required)",
      t3Uv: "pending",
      right: "pending",
      left: "pending",
    };
  }
  const t3Uv = spanViewportUvToT3Uv(viewportUv, sourceRect);
  if (!t3Uv) {
    return {
      label,
      viewportUv: `${viewportUv.u}, ${viewportUv.v}`,
      t3Uv: "outside live viewport",
      right: "outside",
      left: "outside",
    };
  }
  const right = getProjectionSpanRect("right");
  const left = getProjectionSpanRect("left");
  return {
    label,
    viewportUv: `${viewportUv.u}, ${viewportUv.v}`,
    t3Uv: `${t3Uv.u}, ${t3Uv.v}`,
    right: uvInsideSpanRect(t3Uv, right) ? "inside" : "outside",
    left: uvInsideSpanRect(t3Uv, left) ? "inside" : "outside",
  };
}

function fmtPoint(p, keys) {
  return keys.map((k) => `${k}=${p[k]}`).join(", ");
}

const argv = process.argv.slice(2);
const spanId = parseSpanFlag(argv);
const zikimUv = parseUvFlag(argv, "--uv-zikim");
const westUv = parseUvFlag(argv, "--uv-west");
if ((zikimUv || westUv) && !spanId) {
  throw new Error("--span right|left is required when supplying viewport UV");
}

const rightRect = getProjectionSpanRect("right");
const leftRect = getProjectionSpanRect("left");
const sourceRect = spanId == null ? null : getProjectionSpanRect(spanId);

const rows = [
  classify("Zikim", zikimUv, sourceRect),
  classify("2.5 km west", westUv, sourceRect),
];

console.log("Zikim / sea crop UV measurement — no guessed UV");
console.log("");
console.log("Catalog (spec):");
console.log(`  Zikim ITM    ${fmtPoint(ZIKIM_ITM, ["x", "y"])}`);
console.log(`  Zikim WGS84  lng=${ZIKIM_WGS84.lng.toFixed(4)}, lat=${ZIKIM_WGS84.lat.toFixed(4)}`);
console.log(`  West ITM     ${fmtPoint(WEST_ITM, ["x", "y"])}  (2.5 km west)`);
console.log(`  West WGS84   ${fmtPoint(WEST_WGS84, ["lng", "lat"])}  (from ITM via proj4, not UV)`);
console.log("");
console.log("Committed span rects (unchanged by this script):");
console.log(`  getProjectionSpanRect("right")  x0=${rightRect.x0} x1=${rightRect.x1}`);
console.log(`  getProjectionSpanRect("left")   x0=${leftRect.x0} x1=${leftRect.x1}`);
console.log("");
console.log("Lab: projection.html?span=right then ?span=left; project with live map.project().");
console.log("Node cannot synthesize that camera. Paste viewport UV with matching --span right|left.");
console.log(`Conversion source span: ${spanId ?? "pending (supply --span with measured UV)"}`);
console.log("");
console.log("Classification vs span rects (T3 UV in [x0,x1] × [0,1]):");
for (const row of rows) {
  console.log(`  ${row.label}`);
  console.log(`    viewport UV  ${row.viewportUv}`);
  console.log(`    T3 UV        ${row.t3Uv}`);
  console.log(`    right        ${row.right}`);
  console.log(`    left         ${row.left}`);
}
console.log("");
console.log("Record results in docs/nli-exhibit-verification.md. Leave cells pending until measured.");
console.log("Do not edit PROJECTION_SPAN, Tesuga constants, or model-bounds in this task.");
console.log("");
console.log("Lab console (after span camera idle; uses the projection page's live map):");
console.log(`  const zikim = { lng: ${ZIKIM_WGS84.lng.toFixed(4)}, lat: ${ZIKIM_WGS84.lat.toFixed(4)} };`);
console.log(`  const west = { lng: ${WEST_WGS84.lng}, lat: ${WEST_WGS84.lat} };`);
console.log("  function spanViewportUv(lngLat) {");
console.log("    const map = window._maplibreMap;");
console.log("    const p = map.project([lngLat.lng, lngLat.lat]);");
console.log("    const el = map.getContainer();");
console.log("    return { u: p.x / el.clientWidth, v: p.y / el.clientHeight };");
console.log("  }");
console.log("  console.table({ zikim: spanViewportUv(zikim), west: spanViewportUv(west) });");
