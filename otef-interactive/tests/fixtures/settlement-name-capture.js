import { createIdentityProjectionMesh } from "../../frontend/src/shared/projection-warp-geometry.js";
import { prepareProjectionSideMesh } from "../../frontend/src/projection/projection-candidate-validation.js";
import { SIDES } from "../../frontend/src/shared/projection-warp-schema.js";
import { sha256Hex } from "../../scripts/settlement-name-baseline/validate-capture.mjs";

const FONT_PATH = "frontend/fonts/Guttman-Hatzvi.ttf";
const FONT_BYTES = "fixture-guttman-hatzvi";
const PROCESSED_PATH = "projector_base/שמות_יישובים.geojson";
const HASH = {
  digest: "f".repeat(64),
};

const SHARED_WALL_PLACEMENTS = [
  { id: "pid-0067", name: "fixture-visible", output: "left", x: 120, y: 240, width: 48, height: 18 },
  { id: "pid-0424", name: "fixture-offscreen", output: "right", x: 640, y: 360, width: 52, height: 18 },
];

const SHARED_COVERAGE_IDENTITY = {
  left: "fixture-coverage-left",
  right: "fixture-coverage-right",
};

function warpFor(side, meshHash) {
  const { columns, rows } = SIDES[side];
  return {
    enabled: true,
    baseline: {
      type: "tdMesh",
      assetId: `fixture-${side}`,
      sha256: meshHash,
      width: 1920,
      height: 1080,
      origin: "top-left",
    },
    keystone: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    grid: {
      columns,
      rows,
      offsets: Array.from({ length: columns * rows }, () => [0, 0]),
    },
  };
}

function projectionConfig(meshHash) {
  const output = (side) => ({
    crop: { x0: 0, x1: 1, y0: 0, y1: 1 },
    post: { scale: 1, tx: 0, ty: 0 },
    presentationEffect: { enabled: false, mode: "passthrough" },
    warp: warpFor(side, meshHash[side]),
  });
  return {
    schemaVersion: 5,
    pre: { scale: 1, rotateDeg: 0, tx: 0, ty: 0 },
    namesWall: {
      activeMode: "model",
      innerEdgeInsetPx: { left: 0, right: 0 },
      profiles: {
        wall: { requestedFontPx: 12, spacingPx: 2, edgeInsetPx: 0, inwardShiftPercent: 0 },
        model: { requestedFontPx: 7, spacingPx: 0, edgeInsetPx: 0 },
      },
    },
    outputs: { left: output("left"), right: output("right") },
  };
}

function manifestFor(meshHashes) {
  return {
    schemaVersion: 1,
    width: 1920,
    height: 1080,
    assets: Object.fromEntries(Object.entries(SIDES).map(([side, { columns, rows }]) => [side, {
      assetId: `fixture-${side}`,
      path: `warp/${side}.json`,
      sha256: meshHashes[side],
      logicalGrid: { columns, rows },
    }])),
    framing: { path: "framing.json", sha256: "c".repeat(64) },
  };
}

function settlementSource() {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { citycode: "0067", cityname: "fixture-visible" },
        geometry: { type: "Point", coordinates: [34.633504792612285, 31.583835303961564] },
      },
      {
        type: "Feature",
        properties: { citycode: "0424", cityname: "fixture-offscreen" },
        geometry: { type: "Point", coordinates: [34.2, 31.2] },
      },
    ],
  };
}

function processedSourceBytes() {
  return JSON.stringify(settlementSource());
}

function outputFixture(side, config, logicalMesh, meshHashes, liveHash) {
  const meshHash = meshHashes[side];
  const manifest = manifestFor(meshHashes);
  const prepared = prepareProjectionSideMesh(config, side, { mesh: logicalMesh, manifest });
  return {
    output: side,
    instanceId: `fixture-${side}`,
    url: `http://localhost/otef-interactive/projection.html?span=${side}&outputMode=browser`,
    camera: { center: [34.5, 31.4], zoom: 12, bearing: -59, pitch: 0 },
    cssSize: { width: 1920, height: 1080 },
    canvasSize: { width: 1920, height: 1080 },
    pixelRatio: 1,
    source: settlementSource(),
    liveSource: { path: `live-${side}.geojson`, sha256: liveHash },
    mapDescriptor: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], clip: [0, 0, 1, 1] },
    mesh: prepared.mesh,
    logicalMesh,
    baselineManifest: manifest,
    effectiveConfig: config,
    baselineIdentity: {
      type: "tdMesh",
      assetId: `fixture-${side}`,
      sha256: meshHash,
    },
    baselineAsset: { path: `warp/${side}.json`, sha256: meshHash },
    appliedTextLayout: { "text-font": ["Guttman Hatzvi", "Noto Sans Regular"], "text-size": 14, "text-rotate": 35 },
    appliedTextPaint: { "text-color": "#ffffff", "text-halo-width": 0.35 },
    glyphsUrl: null,
    localFontBehavior: "style.glyphs omitted; TinySDF plus projection.html web fonts",
    sceneId: "idle",
    visibilityByCitycode: { "0067": true, "0424": false },
    settled: true,
    ready: true,
    rebuildState: "idle",
    requestedRevision: 1,
    installedRevision: 1,
    serverRevision: 1,
    requestGeneration: 1,
    installedGeneration: 1,
    wall: {
      placements: SHARED_WALL_PLACEMENTS.map((item) => ({ ...item })),
      logicalPlane: { heading: 35, planeScale: 1 },
      coverageIdentity: { ...SHARED_COVERAGE_IDENTITY },
      effectiveFont: 7,
      digest: HASH.digest,
      datasetVersion: "fixture-dataset",
      diagnostics: { state: "valid", expected: 2, placed: 2, missing: 0, extra: 0, duplicate: 0 },
    },
  };
}

export function completeCaptureArtifacts(capture = completeCaptureFixture()) {
  return {
    [capture.processedSource.path]: processedSourceBytes(),
    [capture.fontAssets[0].path]: FONT_BYTES,
  };
}

export function completeCaptureFixture() {
  const meshes = {
    left: createIdentityProjectionMesh({ side: "left" }),
    right: createIdentityProjectionMesh({ side: "right" }),
  };
  const meshHash = {
    left: sha256Hex(JSON.stringify(meshes.left)),
    right: sha256Hex(JSON.stringify(meshes.right)),
  };
  const liveHash = sha256Hex(JSON.stringify(settlementSource()));
  const config = projectionConfig(meshHash);
  return {
    captureId: "fixture-settlement-name",
    capturedAt: "2026-09-29T00:00:00.000Z",
    fontAssets: [{ family: "Guttman Hatzvi", path: FONT_PATH, sha256: sha256Hex(FONT_BYTES) }],
    calibration: {
      revision: 1,
      config,
      presets: [{ id: "preset-fixture", name: "fixture" }],
      selectedPresetId: "preset-fixture",
    },
    processedSource: {
      path: PROCESSED_PATH,
      sha256: sha256Hex(processedSourceBytes()),
      citycodes: ["0067", "0424"],
    },
    outputs: {
      left: outputFixture("left", config, meshes.left, meshHash, liveHash),
      right: outputFixture("right", config, meshes.right, meshHash, liveHash),
    },
  };
}
