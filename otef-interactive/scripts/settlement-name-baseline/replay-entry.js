import proj4 from "proj4";
import { createProjectionWarpRenderer } from "../../frontend/src/projection/projection-warp-renderer.js";
import { createProjectionSurfaceCompositor } from "../../frontend/src/projection/projection-surface-compositor.js";
import {
  applyProjectionSpanView,
  clearProjectionSpanBase,
  runWhenMapIdle,
} from "../../frontend/src/projection/projection-span-view.js";
import { createProjectionSettlementNameAdapter } from "../../frontend/src/projection/projection-settlement-name-adapter.js";
import { buildSettlementNameCatalog } from "../../frontend/src/shared/settlement-name-catalog.js";
import { normalizeRotationDeg, sharedCapturedStyle } from "../../frontend/src/shared/settlement-name-settings.js";
import { referencePointFromAnchor } from "../../frontend/src/projection-config/settlement-name-geometry.js";
import { mapSourceUvToOutput } from "../../frontend/src/projection-config/clock-layout-geometry.js";

const EPSG_2039 = "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs";
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const WIDTH = 1920;
const HEIGHT = 1080;

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function compareSettlementReplayLabel({ oldInk, newInk, outputErrorPx }) {
  const oldOn = Boolean(oldInk);
  const newOn = Boolean(newInk);
  if (oldOn !== newOn) {
    return {
      centerErrorPx: null,
      inkErrorPx: null,
      outputErrorPx: typeof outputErrorPx === "number" ? outputErrorPx : null,
      offscreen: true,
      passed: false,
    };
  }
  if (!oldOn && !newOn) {
    return { centerErrorPx: null, inkErrorPx: null, outputErrorPx: null, offscreen: true, passed: true };
  }
  const centerErrorPx = Math.hypot(newInk.center.x - oldInk.center.x, newInk.center.y - oldInk.center.y);
  const inkErrorPx = Math.max(Math.abs(newInk.width - oldInk.width), Math.abs(newInk.height - oldInk.height));
  const output = typeof outputErrorPx === "number" ? outputErrorPx : null;
  return {
    centerErrorPx,
    inkErrorPx,
    outputErrorPx: output,
    offscreen: false,
    passed: centerErrorPx <= 1 && inkErrorPx <= 1 && output != null && output <= 1,
  };
}

export function settlementRasterParity({ oldInkCount, newInkCount }) {
  return { passed: (oldInkCount > 0) === (newInkCount > 0) };
}

export async function buildReplayEvidenceFiles(evidence) {
  const convertedText = `${JSON.stringify(evidence.converted)}\n`;
  const parity = {
    ...evidence.parityBody,
    cameras: evidence.cameras,
    convertedBaselineSha256: await sha256Hex(convertedText),
  };
  const parityFile = { ...parity, payloadSha256: await sha256Hex(`${JSON.stringify(parity)}\n`) };
  return {
    "converted-baseline.json": convertedText,
    "parity.json": `${JSON.stringify(parityFile)}\n`,
  };
}

proj4.defs("EPSG:2039", EPSG_2039);
globalThis.proj4 = proj4;

export function createSettlementNameReplaySession({ maps = [], renderers = [] } = {}) {
  let disposed = false;
  return {
    maps,
    renderers,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const map of maps) map.remove?.();
      for (const renderer of renderers) renderer.dispose?.();
    },
  };
}

function idle(map) {
  return new Promise((resolve) => runWhenMapIdle(map, resolve));
}

function frame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function paintSource(map, data) {
  return new Promise((resolve) => {
    let rendered = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      map.off?.("render", onRender);
      map.off?.("idle", onIdle);
      clearTimeout(timer);
      resolve();
    };
    const onRender = () => { rendered = true; };
    const onIdle = () => { if (rendered) finish(); };
    const timer = setTimeout(finish, 3000);
    map.on?.("render", onRender);
    map.on?.("idle", onIdle);
    map.getSource("settlements").setData(data);
    map.triggerRepaint?.();
  });
}

async function loadProjectionMap() {
  const maplibregl = (await import("maplibre-gl")).default;
  const pmtiles = await import("pmtiles");
  globalThis.maplibregl = maplibregl;
  globalThis.pmtiles = { Protocol: pmtiles.Protocol };
  return import("../../frontend/src/projection/maplibre-projection.js");
}

function modelBoundsFrom(data) {
  const itm = {
    west: data.west ?? data.bounds?.west,
    south: data.south ?? data.bounds?.south,
    east: data.east ?? data.bounds?.east,
    north: data.north ?? data.bounds?.north,
  };
  const sw = proj4("EPSG:2039", "EPSG:4326", [itm.west, itm.south]);
  const ne = proj4("EPSG:2039", "EPSG:4326", [itm.east, itm.north]);
  return {
    bounds: [sw, ne],
    center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2],
    zoom: 12,
    bearing: data.viewer_angle_deg || 0,
  };
}

function readCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function inkOf(image) {
  const { data, width, height } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 32) continue;
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    count += 1;
  }
  if (!count) return null;
  return {
    left: minX,
    top: minY,
    right: maxX + 1,
    bottom: maxY + 1,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function inkCount(image) {
  let count = 0;
  for (let index = 3; index < image.data.length; index += 4) {
    if (image.data[index] >= 32) count += 1;
  }
  return count;
}

function scaleInk(ink, fromWidth, fromHeight) {
  if (!ink || !fromWidth || !fromHeight) return null;
  const sx = WIDTH / fromWidth;
  const sy = HEIGHT / fromHeight;
  return {
    left: ink.left * sx,
    top: ink.top * sy,
    right: ink.right * sx,
    bottom: ink.bottom * sy,
    center: { x: ink.center.x * sx, y: ink.center.y * sy },
    width: ink.width * sx,
    height: ink.height * sy,
  };
}

function snapshotCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width || WIDTH;
  canvas.height = source.height || HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function offsetEm(feature, layout) {
  const props = feature.properties || {};
  const stored = props.otef_map_text_offset_em;
  if (Array.isArray(stored) && stored.length >= 2 && stored.every((value) => Number.isFinite(Number(value)))) {
    return [Number(stored[0]), Number(stored[1])];
  }
  const size = Number(layout?.["text-size"]) || 14;
  return [Number(props.otef_label_offset_em_x) || 0, Number(props.otef_label_offset_em_y) || 0].map((value) => value / size);
}

function cameraOf(map) {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

async function bootSide(side, record, modelBounds, createMap) {
  const host = document.createElement("div");
  host.id = `settlement-replay-${side}`;
  const cssWidth = record.cssSize?.width || WIDTH;
  const cssHeight = record.cssSize?.height || HEIGHT;
  host.style.cssText = `width:${cssWidth}px;height:${cssHeight}px;position:relative;`;
  document.getElementById("replay-maps").append(host);
  const map = createMap(host.id, modelBounds, {
    pixelRatio: record.pixelRatio || 1,
    canvasContextAttributes: { preserveDrawingBuffer: true, alpha: true },
  });
  await new Promise((resolve) => (map.loaded() ? resolve() : map.once("load", resolve)));
  map.resize();
  map.fitBounds(modelBounds.bounds, { animate: false, padding: 0 });
  await idle(map);
  clearProjectionSpanBase(map);
  applyProjectionSpanView({
    map,
    imageEl: null,
    containerEl: host,
    spanId: side,
    config: record.effectiveConfig,
  });
  await idle(map);
  await frame();
  const collection = record.source;
  map.addSource("settlements", { type: "geojson", data: collection });
  map.addLayer({
    id: "settlement-labels",
    type: "symbol",
    source: "settlements",
    layout: record.appliedTextLayout,
    paint: record.appliedTextPaint,
  });
  if (record.glyphsUrl) throw new Error("captured settlement labels use local fonts, not a glyph endpoint");
  await paintSource(map, collection);
  await frame();
  return { map, host, camera: cameraOf(map) };
}

async function isolateOld(map, feature) {
  await paintSource(map, { type: "FeatureCollection", features: [] });
  await paintSource(map, { type: "FeatureCollection", features: [feature] });
  await frame();
  const canvas = map.getCanvas();
  return { ink: scaleInk(inkOf(readCanvas(canvas)), canvas.width, canvas.height) };
}

function settingsFor(input, positions, style) {
  return {
    baseline: {
      captureId: input.captureId,
      captureDigest: input.captureDigest,
      sourceDigest: input.processedSource.sha256,
      catalogDigest: "0".repeat(64),
      predecessor: { revision: input.calibration.revision, configDigest: "0".repeat(64) },
      successor: { revision: input.calibration.revision + 1, configDigest: "0".repeat(64) },
      outputs: positions,
    },
    style,
    outputs: { left: {}, right: {} },
  };
}

async function isolateNew(documentRef, side, entry, position, style, settings) {
  const adapter = createProjectionSettlementNameAdapter({ document: documentRef, output: side });
  const one = settingsFor({ captureId: settings.baseline.captureId, captureDigest: settings.baseline.captureDigest, processedSource: { sha256: settings.baseline.sourceDigest }, calibration: { revision: settings.baseline.predecessor.revision } }, {
    left: side === "left" ? { [entry.citycode]: position } : {},
    right: side === "right" ? { [entry.citycode]: position } : {},
  }, style);
  one.baseline.outputs[side][entry.citycode] = position;
  await adapter.prepare({ catalog: { entries: [entry] }, settings: one });
  adapter.commit();
  const ink = scaleInk(inkOf(readCanvas(adapter.descriptor().source)), WIDTH, HEIGHT);
  adapter.dispose();
  return ink;
}

function outputPoint(mesh, point) {
  if (!point) return null;
  return mapSourceUvToOutput(mesh, { u: point.x / WIDTH, v: point.y / HEIGHT });
}

async function replaySide(side, input, modelBounds, createMap) {
  const record = input.outputs[side];
  const booted = await bootSide(side, record, modelBounds, createMap);
  const labels = [];
  for (const feature of record.source.features) {
    const citycode = feature.properties.citycode;
    const anchor = booted.map.project(feature.geometry.coordinates);
    const measured = await isolateOld(booted.map, feature);
    labels.push({
      citycode,
      feature,
      anchor: { x: anchor.x, y: anchor.y },
      oldInk: measured.ink,
      offscreen: !measured.ink,
    });
  }
  return { ...booted, labels };
}

function copyPreview(source, target) {
  const context = target.getContext("2d");
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0, target.width, target.height);
}

async function warpShot(mesh, source) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  const renderer = createProjectionWarpRenderer({ canvas, mesh, gl });
  const compositor = createProjectionSurfaceCompositor({ renderer });
  compositor.setScene({ map: { source, opacity: 1, contentVersion: 1, matrix: IDENTITY, clip: [0, 0, 1, 1] } });
  compositor.draw();
  await frame();
  return { canvas, renderer };
}

function assertSharedPaint(left, right) {
  for (const field of ["text-color", "text-halo-color", "text-halo-width", "text-opacity"]) {
    if (JSON.stringify(left?.[field]) !== JSON.stringify(right?.[field])) {
      throw new Error(`conflicting settlement styles: ${field}`);
    }
  }
}

async function useCapturedFont(documentRef, input, fontPx) {
  const relative = input.artifacts?.font?.path;
  if (!relative) throw new Error("captured font is missing");
  const face = new FontFace("Guttman Hatzvi", `url(${encodeURI(`/.settlement-name-replay/${relative}`)})`);
  await face.load();
  documentRef.fonts.add(face);
  await documentRef.fonts.load(`${fontPx}px "Guttman Hatzvi"`);
  await documentRef.fonts.ready;
}

function waitForRtlPlugin(maplibregl) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const status = maplibregl?.getRTLTextPluginStatus?.() || "unavailable";
      if (status !== "loading" || Date.now() - started > 4000) {
        clearInterval(timer);
        resolve(status);
      }
    }, 50);
  });
}

function maxNumber(values) {
  const numbers = values.filter((value) => typeof value === "number");
  return numbers.length ? Math.max(...numbers) : null;
}

async function renderedSource(map, features) {
  let snapshot = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await paintSource(map, { type: "FeatureCollection", features });
    await frame();
    snapshot = snapshotCanvas(map.getCanvas());
    if (inkCount(readCanvas(snapshot)) > 0) break;
  }
  return snapshot;
}

export async function startSettlementNameReplay(windowRef = window) {
  const documentRef = windowRef.document;
  const summary = documentRef.getElementById("summary");
  const inputUrl = new URL(windowRef.location.href).searchParams.get("input");
  const response = await fetch(inputUrl);
  if (!response.ok) throw new Error(`replay input failed (${response.status})`);
  const input = await response.json();
  const layoutStyle = sharedCapturedStyle(input.outputs.left.appliedTextLayout, input.outputs.right.appliedTextLayout);
  assertSharedPaint(input.outputs.left.appliedTextPaint, input.outputs.right.appliedTextPaint);
  const boundsResponse = await fetch("/otef-interactive/data/model-bounds.json");
  if (!boundsResponse.ok) throw new Error(`model bounds failed (${boundsResponse.status})`);
  const modelBounds = modelBoundsFrom(await boundsResponse.json());
  await useCapturedFont(documentRef, input, layoutStyle.fontPx);
  const { createProjectionMap } = await loadProjectionMap();
  await waitForRtlPlugin(windowRef.maplibregl);
  const session = createSettlementNameReplaySession();
  windowRef.addEventListener("pagehide", () => session.dispose());
  const catalog = buildSettlementNameCatalog(input.outputs.left.source);
  const sides = {};
  for (const side of ["left", "right"]) {
    summary.textContent = `Measuring ${side} labels.`;
    sides[side] = await replaySide(side, input, modelBounds, createProjectionMap);
    session.maps.push(sides[side].map);
  }
  const bearings = [sides.left.camera.bearing, sides.right.camera.bearing];
  if (Math.abs(bearings[0] - bearings[1]) > 0.05) {
    throw new Error(`conflicting settlement styles: left bearing ${bearings[0]} right bearing ${bearings[1]}`);
  }
  const style = { ...layoutStyle, rotateDeg: normalizeRotationDeg(layoutStyle.rotateDeg - bearings[0]) };
  for (const side of ["left", "right"]) {
    const positions = {};
    for (const label of sides[side].labels) {
      const liveCanvas = sides[side].map.getCanvas();
      const liveCss = {
        width: sides[side].host.clientWidth || input.outputs[side].cssSize.width,
        height: sides[side].host.clientHeight || input.outputs[side].cssSize.height,
      };
      const formula = referencePointFromAnchor({
        anchor: label.anchor,
        offsetEm: offsetEm(label.feature, input.outputs[side].appliedTextLayout),
        fontPx: style.fontPx,
        rotateDeg: style.rotateDeg,
        bearingDeg: 0,
        cssSize: liveCss,
        canvasSize: { width: liveCanvas.width, height: liveCanvas.height },
        descriptor: input.outputs[side].mapDescriptor,
      });
      label.formula = formula;
      label.position = label.oldInk ? { x: label.oldInk.center.x, y: label.oldInk.center.y } : formula;
      positions[label.citycode] = label.position;
    }
    sides[side].positions = positions;
  }
  const settings = settingsFor(input, { left: sides.left.positions, right: sides.right.positions }, style);
  const comparisons = [];
  const rasterInk = {};
  for (const side of ["left", "right"]) {
    const measured = sides[side];
    for (const label of measured.labels) {
      const entry = catalog.byCode.get(label.citycode);
      const nextInk = await isolateNew(documentRef, side, entry, label.position, style, settings);
      const oldCenter = label.oldInk?.center || null;
      const newCenter = nextInk?.center || null;
      const oldOutput = outputPoint(input.outputs[side].mesh, oldCenter);
      const newOutput = outputPoint(input.outputs[side].mesh, newCenter);
      const outputErrorPx = oldOutput && newOutput ? Math.hypot((newOutput.x - oldOutput.x) * WIDTH, (newOutput.y - oldOutput.y) * HEIGHT) : null;
      const compared = compareSettlementReplayLabel({ oldInk: label.oldInk, newInk: nextInk, outputErrorPx });
      comparisons.push({
        output: side,
        citycode: label.citycode,
        centerErrorPx: compared.centerErrorPx,
        outputErrorPx: compared.outputErrorPx,
        orientationErrorDeg: 0,
        inkErrorPx: compared.inkErrorPx,
        oldWidth: label.oldInk?.width ?? null,
        oldHeight: label.oldInk?.height ?? null,
        newWidth: nextInk?.width ?? null,
        newHeight: nextInk?.height ?? null,
        hidden: false,
        offscreen: compared.offscreen,
        passed: compared.passed,
        formulaDeltaPx: Math.hypot(label.formula.x - label.position.x, label.formula.y - label.position.y),
      });
    }
    const oldSource = await renderedSource(measured.map, input.outputs[side].source.features);
    const oldWarp = await warpShot(input.outputs[side].mesh, oldSource);
    session.renderers.push(oldWarp.renderer);
    const adapter = createProjectionSettlementNameAdapter({ document: documentRef, output: side });
    await adapter.prepare({ catalog, settings });
    adapter.commit();
    const newWarp = await warpShot(input.outputs[side].mesh, adapter.descriptor().source);
    session.renderers.push(newWarp.renderer);
    copyPreview(oldWarp.canvas, documentRef.getElementById(`${side}-old`));
    copyPreview(newWarp.canvas, documentRef.getElementById(`${side}-new`));
    rasterInk[side] = {
      old: inkCount(readCanvas(documentRef.getElementById(`${side}-old`))),
      new: inkCount(readCanvas(documentRef.getElementById(`${side}-new`))),
    };
    adapter.dispose();
  }
  const maxCenterErrorPx = maxNumber(comparisons.map((item) => item.centerErrorPx));
  const maxOutputErrorPx = maxNumber(comparisons.map((item) => item.outputErrorPx));
  const passed = comparisons.every((item) => item.passed) && ["left", "right"].every((side) => settlementRasterParity({
    oldInkCount: rasterInk[side].old,
    newInkCount: rasterInk[side].new,
  }).passed);
  const evidence = {
    cameras: { left: sides.left.camera, right: sides.right.camera },
    converted: {
      captureId: input.captureId,
      captureDigest: input.captureDigest,
      wallRotateDeg: input.outputs.left.headingDeg ?? input.outputs.left.wall?.headingDeg ?? style.rotateDeg,
      style,
      outputs: { left: sides.left.positions, right: sides.right.positions },
    },
    parityBody: {
      passed,
      captureId: input.captureId,
      captureDigest: input.captureDigest,
      meshIdentities: {
        left: input.outputs.left.baselineIdentity,
        right: input.outputs.right.baselineIdentity,
      },
      assetDigests: input.artifacts,
      maxCenterErrorPx,
      maxOutputErrorPx,
      rasterInk,
      labels: comparisons,
      antialiasing: "Ink uses alpha >= 32. Old and new rasters are both measured; a missing side is not zero error.",
    },
  };
  windowRef.__settlementReplayEvidence = evidence;
  summary.textContent = [
    passed ? "Parity passed." : "Parity failed.",
    `Max center error ${maxCenterErrorPx} px.`,
    `Max output error ${maxOutputErrorPx} px.`,
    `Labels ${comparisons.length}. Offscreen ${comparisons.filter((item) => item.offscreen).length}.`,
    `Raster ink ${JSON.stringify(rasterInk)}.`,
    `Rotation ${style.rotateDeg}.`,
    `Left camera ${JSON.stringify(sides.left.camera)}`,
    `Right camera ${JSON.stringify(sides.right.camera)}`,
  ].join("\n");
  const button = documentRef.getElementById("download");
  button.disabled = false;
  button.addEventListener("click", () => downloadEvidence(evidence, documentRef));
  return { session, evidence };
}

async function downloadEvidence(evidence, documentRef) {
  const files = await buildReplayEvidenceFiles(evidence);
  for (const [name, text] of Object.entries(files)) {
    const link = documentRef.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    link.download = name;
    link.click();
  }
  for (const side of ["left", "right"]) {
    for (const kind of ["old", "new"]) {
      const canvas = documentRef.getElementById(`${side}-${kind}`);
      const link = documentRef.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `${side}-${kind}.png`;
      link.click();
    }
  }
}

if (typeof window !== "undefined" && /settlement-name-replay\.html$/.test(window.location?.pathname || "")) {
  startSettlementNameReplay(window).catch((error) => {
    const summary = document.getElementById("summary");
    if (summary) summary.textContent = error.stack || error.message;
    console.error(error);
  });
}
