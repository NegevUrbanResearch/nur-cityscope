import fs from "node:fs";
import { describe, expect, test, vi } from "vitest";
import {
  mixAcrossLineColor,
  overlapClassWidthPt,
  staggerDelayMs,
  revealDurationMs,
  tessellateRibbon,
  tessellateHub,
  hubEnvelopeWidth,
  taperedWidthPt,
  taperedHalfWidthPx,
  sampleWinningCenterlineIdsAroundHub,
  localWidthPtAt,
  ribbonFrameAtProgress,
  encodeRibbonFragDepth,
  ribbonWidthPx,
  NOVA_RIBBON_DISPLAY_PROFILES,
  TESSELLATION_STRIDE,
  buildRibbonVertexData,
  createAcrossLineRibbonLayer,
  ribbonColorDepthFunc,
  ribbonFeatherCoverage,
  inflatedHalfWidthPx,
} from "../../frontend/src/shared/maplibre-acrossline-ribbon.js";
import { NLI_DISPLAY_PROFILES } from "../../frontend/src/shared/nli-investigation-theme.js";

const unitLine = [
  [0, 0],
  [1, 0],
];
const line = unitLine;

function hexToRgb01(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function hubFixture(n) {
  const hub = [0, 0];
  const span = 100;
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (2 * Math.PI * i) / n;
    lines.push({
      id: i,
      coordinates: [hub, [span * Math.cos(angle), span * Math.sin(angle)]],
    });
  }
  return { hub, lines };
}

describe("maplibre AcrossLine ribbon", () => {
  test("v is across-width; solid bands are the outer 12.5%, ramp is the middle 75%", () => {
    expect(mixAcrossLineColor(0)).toEqual(hexToRgb01("#f5f500"));
    expect(mixAcrossLineColor(0.125)).toEqual(hexToRgb01("#f5f500"));
    expect(mixAcrossLineColor(0.20)).not.toEqual(hexToRgb01("#f5f500"));
    expect(mixAcrossLineColor(0.20)).not.toEqual(hexToRgb01("#f50000"));
    expect(mixAcrossLineColor(0.5)).not.toEqual(hexToRgb01("#f5f500"));
    expect(mixAcrossLineColor(0.875)).toEqual(hexToRgb01("#f50000"));
    expect(mixAcrossLineColor(1)).toEqual(hexToRgb01("#f50000"));
  });

  test("does not invert compensated IR colors", () => {
    const ir = { fromColor: "#f5f500", toColor: "#f50000" };
    expect(mixAcrossLineColor(0, ir)).toEqual(hexToRgb01("#f5f500"));
  });

  test("tapered strip is wider at Nova u=0 than at the far end", () => {
    const ir = { taperFromWidthPt: 1, taperToWidthPt: 0, widthPt: 1 };
    expect(taperedWidthPt(0, ir)).toBeGreaterThan(taperedWidthPt(1, ir));
  });

  test("overlap class width IS the stroke width, not 1pt plus class", () => {
    const wide = tessellateRibbon(unitLine, { count: 235 });
    const thin = tessellateRibbon(unitLine, { count: 1 });
    expect(localWidthPtAt(wide, 0)).toBe(4);
    expect(localWidthPtAt(thin, 0)).toBe(0.5);
    expect(localWidthPtAt(wide, 1)).toBe(0);
    expect(localWidthPtAt(wide, 0)).not.toBe(1);
    expect(localWidthPtAt(wide, 0)).not.toBe(5);
  });

  test("stagger and duration formulas", () => {
    expect(staggerDelayMs(1)).toBe(300);
    expect(staggerDelayMs(8)).toBe(0);
    expect(revealDurationMs(0)).toBe(4000);
    expect(revealDurationMs(20000)).toBe(5000);
    expect(revealDurationMs(40000)).toBe(5000);
  });

  test("overlap class widths from COUNT_", () => {
    expect(overlapClassWidthPt(1)).toBe(0.5);
    expect(overlapClassWidthPt(13)).toBe(0.5);
    expect(overlapClassWidthPt(14)).toBe(1.375);
    expect(overlapClassWidthPt(147)).toBe(4);
  });

  test("hub n>=8 and 416: one winner per sample on a ring around the shared vertex", () => {
    for (const n of [8, 416]) {
      const mesh = tessellateHub(hubFixture(n), { taperFromWidthPt: 1, taperToWidthPt: 0 });
      expect(hubEnvelopeWidth(mesh)).toBeLessThan(3 * taperedHalfWidthPx(0, { taperFromWidthPt: 1 }));
      expect(mesh.capCountAtHub).toBeLessThanOrEqual(1);
      const winners = sampleWinningCenterlineIdsAroundHub(mesh, { radiusPx: 2, samples: 16 });
      expect(winners.every((ids) => ids.length === 1)).toBe(true);
      expect(mesh.blendedFragmentCount).toBe(0);
    }
  });

  test("reveal clip uses the custom layer; source never imports route-progress overlay", () => {
    const src = fs.readFileSync(new URL("../../frontend/src/shared/maplibre-acrossline-ribbon.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/line-gradient|line-progress|maplibre-route-progress-overlay/);
    const frame = ribbonFrameAtProgress(0.3);
    expect(frame.layerType).toBe("custom");
    expect(frame.usesLineGradient).toBe(false);
  });

  test("solid ribbons: tessellator ignores dashArray", () => {
    const mesh = tessellateRibbon(line, { dashArray: [2, 2], taperFromWidthPt: 1, taperToWidthPt: 0 });
    expect(mesh.dashed).toBe(false);
  });

  test("GPU depth keeps nearest-centerline ahead of object-id bias", () => {
    const farLowId = encodeRibbonFragDepth(0.3, 1);
    const nearHighId = encodeRibbonFragDepth(0.1, 416);
    expect(nearHighId).toBeLessThan(farLowId);

    const nearSaturatingId = encodeRibbonFragDepth(0, 2047);
    const farLowEdge = encodeRibbonFragDepth(0.9, 1);
    expect(nearSaturatingId).toBeLessThan(farLowEdge);
    expect(nearSaturatingId).toBeLessThan(1);

    const highIdMesh = tessellateRibbon(unitLine, {
      id: 416,
      taperFromWidthPt: 1,
      taperToWidthPt: 0,
    });
    const saturatingMesh = tessellateRibbon(unitLine, {
      id: 2047,
      taperFromWidthPt: 1,
      taperToWidthPt: 0,
    });
    expect(highIdMesh.vertexData[6]).toBeCloseTo(encodeRibbonFragDepth(0, 416));
    expect(saturatingMesh.vertexData[6]).toBeCloseTo(encodeRibbonFragDepth(0, 2047));
    expect(saturatingMesh.vertexData[6]).toBeLessThan(0.01);
  });

  test("Nova GIS ribbon display scale makes 1pt at least 8px without changing global profiles", () => {
    expect(ribbonWidthPx(1, NOVA_RIBBON_DISPLAY_PROFILES.gis)).toBeGreaterThanOrEqual(8);
    expect(ribbonWidthPx(1, NOVA_RIBBON_DISPLAY_PROFILES.projection))
      .toBeGreaterThanOrEqual(ribbonWidthPx(1, NOVA_RIBBON_DISPLAY_PROFILES.gis));
    expect(ribbonWidthPx(1, NLI_DISPLAY_PROFILES.gis)).toBeLessThan(8);
    expect(NLI_DISPLAY_PROFILES.gis.lineWidthMultiplier).toBe(1);
    expect(NLI_DISPLAY_PROFILES.gis.routeScale).toBe(1);
  });

  test("color pass depth func is LEQUAL rather than EQUAL", () => {
    const gl = { LEQUAL: 0x0203, EQUAL: 0x0202 };
    expect(ribbonColorDepthFunc(gl)).toBe(gl.LEQUAL);
    expect(ribbonColorDepthFunc(gl)).not.toBe(gl.EQUAL);
    const src = fs.readFileSync(
      new URL("../../frontend/src/shared/maplibre-acrossline-ribbon.js", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/depthFunc\(.*LEQUAL/);
    expect(src).not.toMatch(/depthFunc\(gl\.EQUAL\)/);
  });

  test("completed ribbons skip tessellation when unitsPerPx is unchanged", () => {
    const features = [{
      type: "Feature",
      properties: { OBJECTID: 1 },
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
    }];
    const cache = new Map();
    const first = buildRibbonVertexData(features, {
      unitsPerPx: 1,
      featureProgress: () => 1,
      profile: NOVA_RIBBON_DISPLAY_PROFILES.gis,
      cache,
    });
    const second = buildRibbonVertexData(features, {
      unitsPerPx: 1,
      featureProgress: () => 1,
      profile: NOVA_RIBBON_DISPLAY_PROFILES.gis,
      cache,
    });
    expect(first.rebuiltCount).toBe(1);
    expect(second.rebuiltCount).toBe(0);
    expect(first.tessellationData).toBeDefined();
    expect(second.tessellationData).toBe(first.tessellationData);
  });

  test("revealing ribbons reuse tessellation at the same unitsPerPx", () => {
    const features = [
      {
        type: "Feature",
        properties: { OBJECTID: 1 },
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
      },
      {
        type: "Feature",
        properties: { OBJECTID: 2 },
        geometry: { type: "LineString", coordinates: [[0, 1], [1, 1]] },
      },
    ];
    const cache = new Map();
    const first = buildRibbonVertexData(features, {
      unitsPerPx: 1,
      featureProgress: () => 0.4,
      profile: NOVA_RIBBON_DISPLAY_PROFILES.projection,
      cache,
    });
    const second = buildRibbonVertexData(features, {
      unitsPerPx: 1,
      featureProgress: () => 0.7,
      profile: NOVA_RIBBON_DISPLAY_PROFILES.projection,
      cache,
    });
    expect(first.rebuiltCount).toBe(2);
    expect(second.rebuiltCount).toBe(0);
    expect(second.tessellationData).toBe(first.tessellationData);
    expect(second.progressData).not.toBe(first.progressData);
    expect(second.progressData.length).toBe(first.tessellationData.length / TESSELLATION_STRIDE);
    expect(first.progressData[0]).toBeCloseTo(0.4);
    expect(second.progressData[0]).toBeCloseTo(0.7);
  });

  test("unitsPerPx change retessellates and stagger writes different a_revealUntil", () => {
    const features = [
      {
        type: "Feature",
        properties: { OBJECTID: 1 },
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
      },
      {
        type: "Feature",
        properties: { OBJECTID: 2 },
        geometry: { type: "LineString", coordinates: [[0, 1], [1, 1]] },
      },
    ];
    const cache = new Map();
    buildRibbonVertexData(features, {
      unitsPerPx: 1,
      featureProgress: () => 1,
      profile: NOVA_RIBBON_DISPLAY_PROFILES.projection,
      cache,
    });
    const zoomed = buildRibbonVertexData(features, {
      unitsPerPx: 2,
      featureProgress: () => 1,
      profile: NOVA_RIBBON_DISPLAY_PROFILES.projection,
      cache,
    });
    expect(zoomed.rebuiltCount).toBe(2);
    const staggered = buildRibbonVertexData(features, {
      unitsPerPx: 2,
      featureProgress: (feature) => (feature.properties.OBJECTID === 1 ? 0.2 : 0.9),
      profile: NOVA_RIBBON_DISPLAY_PROFILES.projection,
      cache,
    });
    expect(staggered.rebuiltCount).toBe(0);
    const vertsPerFeature = staggered.vertexCount / 2;
    expect(staggered.progressData[0]).toBeCloseTo(0.2);
    expect(staggered.progressData[vertsPerFeature]).toBeCloseTo(0.9);
  });

  test("unitsPerPx generation eviction drops superseded tessellation", () => {
    const features = [{
      type: "Feature",
      properties: { OBJECTID: 1 },
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
    }];
    const cache = new Map();
    const profile = NOVA_RIBBON_DISPLAY_PROFILES.gis;
    const first = buildRibbonVertexData(features, {
      unitsPerPx: 1,
      featureProgress: () => 1,
      profile,
      cache,
    });
    buildRibbonVertexData(features, {
      unitsPerPx: 2,
      featureProgress: () => 1,
      profile,
      cache,
    });
    const restored = buildRibbonVertexData(features, {
      unitsPerPx: 1,
      featureProgress: () => 1,
      profile,
      cache,
    });
    expect(restored.rebuiltCount).toBe(1);
    expect(restored.tessellationData).not.toBe(first.tessellationData);

    const sameZoom = buildRibbonVertexData(features, {
      unitsPerPx: 1,
      featureProgress: () => 1,
      profile,
      cache,
    });
    expect(sameZoom.rebuiltCount).toBe(0);
    expect(sameZoom.tessellationData).toBe(restored.tessellationData);
  });

  test("same OBJECTID with changed coordinates, COUNT_, or width retessellates", () => {
    const profile = NOVA_RIBBON_DISPLAY_PROFILES.projection;
    const cache = new Map();
    const feature = {
      type: "Feature",
      properties: { OBJECTID: 1, COUNT_: 10 },
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
    };
    const options = {
      unitsPerPx: 1,
      featureProgress: () => 1,
      profile,
      cache,
    };
    const first = buildRibbonVertexData([feature], options);
    expect(first.rebuiltCount).toBe(1);

    feature.geometry.coordinates = [[0, 0], [2, 0]];
    const moved = buildRibbonVertexData([feature], options);
    expect(moved.rebuiltCount).toBeGreaterThan(0);
    expect(moved.tessellationData).not.toBe(first.tessellationData);

    feature.properties.COUNT_ = 200;
    const recounted = buildRibbonVertexData([feature], options);
    expect(recounted.rebuiltCount).toBeGreaterThan(0);
    expect(recounted.tessellationData).not.toBe(moved.tessellationData);

    feature.properties.acrossLine = { taperFromWidthPt: 8, taperToWidthPt: 1 };
    const widened = buildRibbonVertexData([feature], options);
    expect(widened.rebuiltCount).toBeGreaterThan(0);
    expect(widened.tessellationData).not.toBe(recounted.tessellationData);
  });

  test("small interior coordinate change retessellates", () => {
    const profile = NOVA_RIBBON_DISPLAY_PROFILES.projection;
    const cache = new Map();
    const feature = {
      type: "Feature",
      properties: { OBJECTID: 1 },
      geometry: { type: "LineString", coordinates: [[0, 0], [0.5, 0], [1, 0]] },
    };
    const options = {
      unitsPerPx: 1,
      featureProgress: () => 1,
      profile,
      cache,
    };
    const first = buildRibbonVertexData([feature], options);
    expect(first.rebuiltCount).toBe(1);
    const unchanged = buildRibbonVertexData([feature], options);
    expect(unchanged.rebuiltCount).toBe(0);
    expect(unchanged.tessellationData).toBe(first.tessellationData);

    feature.geometry.coordinates[1][0] += 1e-8;
    const nudged = buildRibbonVertexData([feature], options);
    expect(nudged.rebuiltCount).toBeGreaterThan(0);
    expect(nudged.tessellationData).not.toBe(first.tessellationData);
  });

  test("shared-start membership change retessellates the affected feature", () => {
    const profile = NOVA_RIBBON_DISPLAY_PROFILES.projection;
    const featureA = {
      type: "Feature",
      properties: { OBJECTID: 1 },
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
    };
    const featureB = {
      type: "Feature",
      properties: { OBJECTID: 2 },
      geometry: { type: "LineString", coordinates: [[0, 0], [0, 1]] },
    };
    const options = {
      unitsPerPx: 1,
      featureProgress: () => 1,
      profile,
    };

    const addedNeighbor = new Map();
    const alone = buildRibbonVertexData([featureA], { ...options, cache: addedNeighbor });
    expect(alone.rebuiltCount).toBe(1);
    const together = buildRibbonVertexData([featureA, featureB], { ...options, cache: addedNeighbor });
    expect(together.rebuiltCount).toBe(2);
    expect(together.tessellationData).not.toBe(alone.tessellationData);

    const removedNeighbor = new Map();
    const shared = buildRibbonVertexData([featureA, featureB], { ...options, cache: removedNeighbor });
    expect(shared.rebuiltCount).toBe(2);
    const restored = buildRibbonVertexData([featureA], { ...options, cache: removedNeighbor });
    expect(restored.rebuiltCount).toBe(1);
    expect(restored.tessellationData).not.toBe(shared.tessellationData);
    expect(restored.vertexCount).toBe(alone.vertexCount);
  });

  test("feather coverage is full at dist 0 and 0 at or beyond the geometric edge", () => {
    expect(ribbonFeatherCoverage(0)).toBe(1);
    expect(ribbonFeatherCoverage(1)).toBe(0);
    expect(ribbonFeatherCoverage(1.2)).toBe(0);
  });

  test("feather coverage stays opaque in the geometric core and ramps to the GPU edge", () => {
    expect(ribbonFeatherCoverage(0.5, 0, 0.7)).toBe(1);
    const midFeather = ribbonFeatherCoverage(0.85, 0, 0.7);
    expect(midFeather).toBeGreaterThan(0);
    expect(midFeather).toBeLessThan(1);
    expect(ribbonFeatherCoverage(1, 0, 0.7)).toBe(0);
  });

  test("inflated half-width is wider than geometric half-width", () => {
    const geometric = taperedHalfWidthPx(0, { taperFromWidthPt: 1, taperToWidthPt: 0 });
    expect(inflatedHalfWidthPx(geometric)).toBeGreaterThan(geometric);
  });

  test("tessellated GPU strip extends past the geometric left/right edge", () => {
    const mesh = tessellateRibbon(unitLine, { taperFromWidthPt: 1, taperToWidthPt: 0, unitsPerPx: 1 });
    const geometricHalf = Math.hypot(mesh.left[0][0] - mesh.right[0][0], mesh.left[0][1] - mesh.right[0][1]) / 2;
    const gpuHalf = Math.hypot(
      mesh.vertexData[0] - mesh.vertexData[TESSELLATION_STRIDE],
      mesh.vertexData[1] - mesh.vertexData[TESSELLATION_STRIDE + 1],
    ) / 2;
    expect(gpuHalf).toBeGreaterThan(geometricHalf);
  });

  test("GPU verts store radial independently of AcrossLine v so caps feather from core", () => {
    const ir = { taperFromWidthPt: 1, taperToWidthPt: 0 };
    const mesh = tessellateRibbon(unitLine, { ...ir, unitsPerPx: 1 });
    const geometric = taperedHalfWidthPx(0, ir);
    const inflated = inflatedHalfWidthPx(geometric);
    const coreRatio = geometric / inflated;
    const stride = TESSELLATION_STRIDE;
    expect(mesh.vertexData[4]).toBe(-1);
    expect(mesh.vertexData[5]).toBeCloseTo(coreRatio);
    const capCenter = stride * 6;
    expect(mesh.vertexData[capCenter + 4]).toBe(0);
    expect(mesh.vertexData[capCenter + 5]).toBeCloseTo(coreRatio);
    expect(mesh.vertexData[capCenter + stride + 4]).toBe(1);
  });

  test("mixAcrossLineColor stays yellow-to-red across v after feather", () => {
    expect(mixAcrossLineColor(0)).toEqual(hexToRgb01("#f5f500"));
    expect(mixAcrossLineColor(1)).toEqual(hexToRgb01("#f50000"));
  });

  test("fragment shader feathers coverage and does not swap AcrossLine colors", () => {
    const src = fs.readFileSync(
      new URL("../../frontend/src/shared/maplibre-acrossline-ribbon.js", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/v_radial < 0\.0/);
    expect(src).toMatch(/smoothstep\(max\(core\s*-\s*aa/);
    expect(src).not.toMatch(/smoothstep\(1\.0\s*-\s*aa,\s*1\.0,\s*dist\)/);
    expect(src).toMatch(/fwidth/);
    expect(src).toMatch(/245\.0, 245\.0, 0\.0/);
    expect(src).toMatch(/245\.0, 0\.0, 0\.0/);
    expect(src).not.toMatch(/fromColor = vec3\(245\.0, 0\.0, 0\.0\)/);
  });

  test("shader discards unrevealed fragments in both passes before depth", () => {
    const src = fs.readFileSync(
      new URL("../../frontend/src/shared/maplibre-acrossline-ribbon.js", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/if\s*\(\s*v_uv\.x\s*>\s*v_revealUntil/);
    expect(src).toMatch(/discard/);
    const discardAt = src.search(/if\s*\(\s*v_uv\.x\s*>\s*v_revealUntil/);
    const depthAt = src.indexOf("gl_FragDepth");
    expect(discardAt).toBeGreaterThan(-1);
    expect(depthAt).toBeGreaterThan(discardAt);
    expect(src.slice(discardAt, depthAt)).toMatch(/discard/);
    expect(src).toMatch(/smoothstep\([^;]*v_revealUntil/);
    expect(src).toMatch(/in float a_revealUntil/);
    expect(src).not.toMatch(/uniform float u_reveal/);
  });

  test("same-zoom reveal frames do not bufferData the full interleaved mesh", () => {
    const gl = createFakeRibbonGL();
    const features = [
      {
        type: "Feature",
        properties: { OBJECTID: 1 },
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
      },
      {
        type: "Feature",
        properties: { OBJECTID: 2 },
        geometry: { type: "LineString", coordinates: [[0, 1], [1, 1]] },
      },
    ];
    let progress = 0.4;
    const layer = createAcrossLineRibbonLayer({
      id: "nli-nova-escape-individual",
      profile: "projection",
      getFrame: () => ({
        features,
        featureProgress: () => progress,
        opacity: 0.6,
      }),
    });
    const map = {
      triggerRepaint: vi.fn(),
      transform: { worldSize: 1 },
    };
    layer.onAdd(map, gl);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    layer.render(gl, identity);
    const firstUploads = gl.bufferData.mock.calls.map((call) => call[1]);
    const tessellationUpload = firstUploads.find((data) => (
      data && data.length > 16 && data.length % TESSELLATION_STRIDE === 0
      && data.length !== data.length / TESSELLATION_STRIDE
    ));
    expect(tessellationUpload).toBeDefined();
    const vertexCount = tessellationUpload.length / TESSELLATION_STRIDE;
    const progressUpload = firstUploads.find((data) => (
      data instanceof Float32Array && data.length === vertexCount
    ));
    expect(progressUpload).toBeDefined();
    const tessellationUploads = gl.bufferData.mock.calls.filter((call) => call[1]?.length !== undefined
      ? call[1].length > 16
      : (call[1]?.byteLength ?? 0) > 64).length;
    expect(gl.bufferData.mock.calls.length).toBeGreaterThan(0);
    progress = 0.7;
    layer.render(gl, identity);
    const tessellationAfter = gl.bufferData.mock.calls.filter((call) => (
      (call[1]?.length ?? call[1]?.byteLength ?? 0) > 64
    )).length;
    expect(tessellationAfter).toBe(tessellationUploads);
    expect(gl.bufferSubData.mock.calls.length).toBeGreaterThan(0);
    expect(gl._subDataTargets.every((buffer) => gl._initializedBuffers.has(buffer))).toBe(true);

    layer.onRemove(map, gl);
    layer.onAdd(map, gl);
    layer.render(gl, identity);
    expect(gl._initializedBuffers.has(layer.progressBuffer)).toBe(true);
    expect(gl._subDataTargets.every((buffer) => gl._initializedBuffers.has(buffer))).toBe(true);
  });
});

function createFakeRibbonGL() {
  let bound = null;
  const initialized = new Set();
  const subDataTargets = [];
  const bufferData = vi.fn((_target, _data, _usage) => {
    if (bound) initialized.add(bound);
  });
  const bufferSubData = vi.fn((_target, _offset, _data) => {
    subDataTargets.push(bound);
  });
  return {
    VERTEX_SHADER: 0x8B31,
    FRAGMENT_SHADER: 0x8B30,
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88E8,
    FLOAT: 0x1406,
    TRIANGLES: 4,
    DEPTH_TEST: 1,
    LESS: 2,
    LEQUAL: 3,
    BLEND: 4,
    SRC_ALPHA: 5,
    ONE_MINUS_SRC_ALPHA: 6,
    COLOR_BUFFER_BIT: 0,
    DEPTH_BUFFER_BIT: 0,
    LINK_STATUS: 1,
    COMPILE_STATUS: 1,
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn((_target, buffer) => {
      bound = buffer;
    }),
    bufferData,
    bufferSubData,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),
    getUniformLocation: vi.fn(() => 1),
    getAttribLocation: vi.fn((program, name) => (
      name === "a_revealUntil" ? 7 : 1
    )),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    uniform1f: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    depthFunc: vi.fn(),
    depthMask: vi.fn(),
    colorMask: vi.fn(),
    blendFunc: vi.fn(),
    clearDepth: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
    deleteBuffer: vi.fn(),
    _initializedBuffers: initialized,
    _subDataTargets: subDataTargets,
  };
}
