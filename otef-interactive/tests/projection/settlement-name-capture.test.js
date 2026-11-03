import { expect, test } from "vitest";
import { sha256Hex, validateCapture } from "../../scripts/settlement-name-baseline/validate-capture.mjs";
import { completeCaptureArtifacts, completeCaptureFixture } from "../fixtures/settlement-name-capture.js";

test("partial capture cannot authorize reload", () => {
  const capture = completeCaptureFixture();
  delete capture.outputs.right.mesh;
  expect(validateCapture(capture)).toContain("outputs.right.mesh");
});

test("baseline keeps every citycode including leading zeroes and offscreen labels", () => {
  const capture = completeCaptureFixture();
  expect(validateCapture(capture, { artifacts: completeCaptureArtifacts(capture) })).toEqual([]);
  expect(capture.outputs.left.source.features.map((feature) => feature.properties.citycode)).toContain("0067");
});

test("rejects fabricated source and mesh beside correctly hashed files", () => {
  const capture = completeCaptureFixture();
  const processed = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { citycode: "9999", cityname: "substituted" },
      geometry: { type: "Point", coordinates: [1, 2] },
    }],
  };
  const processedBytes = JSON.stringify(processed);
  capture.processedSource.sha256 = sha256Hex(processedBytes);

  const live = structuredClone(capture.outputs.left.source);
  live.features[0].properties.cityname = "substituted";
  const liveBytes = JSON.stringify(live);
  capture.outputs.left.liveSource.sha256 = sha256Hex(liveBytes);

  const mesh = structuredClone(capture.outputs.left.logicalMesh);
  mesh.vertices[0] = { ...mesh.vertices[0], x: mesh.vertices[0].x + 1 };
  const meshBytes = JSON.stringify(mesh);
  const meshHash = sha256Hex(meshBytes);
  capture.outputs.left.baselineAsset.sha256 = meshHash;
  capture.outputs.left.baselineIdentity.sha256 = meshHash;
  capture.calibration.config.outputs.left.warp.baseline.sha256 = meshHash;
  capture.outputs.left.baselineManifest.assets.left.sha256 = meshHash;

  const errors = validateCapture(capture, {
    artifacts: {
      [capture.processedSource.path]: processedBytes,
      [capture.outputs.left.liveSource.path]: liveBytes,
      [capture.outputs.left.baselineAsset.path]: meshBytes,
    },
  });
  expect(errors).toEqual(expect.arrayContaining([
    "processedSource.citycodes",
    "outputs.left.liveSource",
    "outputs.left.logicalMesh",
  ]));
});

test("rejects left and right geometry that disagrees beyond citycodes", () => {
  const coordinates = completeCaptureFixture();
  coordinates.outputs.right.source.features[0].geometry.coordinates = [35.1, 32.2];
  expect(validateCapture(coordinates)).toContain("outputs.geometry");

  const properties = completeCaptureFixture();
  properties.outputs.right.source.features[0].properties.cityname = "changed";
  expect(validateCapture(properties)).toContain("outputs.featureProperties");
});

test("rejects applied revisions that do not match calibration.revision", () => {
  const capture = completeCaptureFixture();
  capture.outputs.left.requestedRevision = 2;
  capture.outputs.left.installedRevision = 2;
  capture.outputs.left.serverRevision = 2;
  expect(validateCapture(capture)).toContain("outputs.left.requestedRevision");
});

test("rejects dummy processed-source and font hashes without bytes", () => {
  const capture = completeCaptureFixture();
  capture.processedSource.sha256 = "a".repeat(64);
  capture.fontAssets[0].sha256 = "b".repeat(64);
  expect(validateCapture(capture)).toEqual(expect.arrayContaining([
    "processedSource.sha256 unverifiable",
    "fontAssets[0].sha256 unverifiable",
  ]));
});

test("rejects wrong or missing embedded hashes without artifact files", () => {
  const wrong = completeCaptureFixture();
  wrong.outputs.left.liveSource.sha256 = "1".repeat(64);
  wrong.outputs.left.baselineAsset.sha256 = "2".repeat(64);
  wrong.outputs.left.baselineIdentity.sha256 = "2".repeat(64);
  wrong.calibration.config.outputs.left.warp.baseline.sha256 = "2".repeat(64);
  wrong.outputs.left.baselineManifest.assets.left.sha256 = "2".repeat(64);
  expect(validateCapture(wrong)).toEqual(expect.arrayContaining([
    "outputs.left.liveSource.sha256",
    "outputs.left.baselineAsset.sha256",
  ]));

  const missing = completeCaptureFixture();
  delete missing.outputs.right.liveSource.sha256;
  delete missing.outputs.right.baselineAsset.sha256;
  expect(validateCapture(missing)).toEqual(expect.arrayContaining([
    "outputs.right.liveSource.sha256",
    "outputs.right.baselineAsset.sha256",
  ]));
});

test("rejects malformed wall evidence when placements, diagnostics, or pages are present", () => {
  const placement = completeCaptureFixture();
  placement.outputs.left.wall.placements[0].x = Number.NaN;
  placement.outputs.left.wall.placements[1].width = Number.POSITIVE_INFINITY;
  expect(validateCapture(placement)).toContain("outputs.left.wall.placements");

  const diagnostics = completeCaptureFixture();
  diagnostics.outputs.right.wall.diagnostics.expected = Number.POSITIVE_INFINITY;
  diagnostics.outputs.right.wall.diagnostics.placed = true;
  expect(validateCapture(diagnostics)).toContain("outputs.right.wall.diagnostics");

  const missingKey = completeCaptureFixture();
  delete missingKey.outputs.left.wall.diagnostics.missing;
  expect(validateCapture(missingKey)).toContain("outputs.left.wall.diagnostics");

  const pages = completeCaptureFixture();
  pages.outputs.left.wall.pages = {
    left: { left: 0, right: Number.NaN, y0: 0, y1: 10 },
  };
  expect(validateCapture(pages)).toContain("outputs.left.wall.pages");
});

test("rejects settlement citycode placements and width-height logical planes", () => {
  const capture = completeCaptureFixture();
  capture.outputs.left.wall.placements = [
    { citycode: "0067", x: 10, y: 20, width: 30, height: 12 },
    { citycode: "0424", x: 40, y: 50, width: 30, height: 12 },
  ];
  capture.outputs.left.wall.logicalPlane = { width: 1920, height: 1080 };
  const errors = validateCapture(capture);
  expect(errors).toEqual(expect.arrayContaining([
    "outputs.left.wall.placements",
    "outputs.left.wall.logicalPlane",
  ]));
});

test("accepts shared wall placements with mixed outputs and object coverage identities", () => {
  const capture = completeCaptureFixture();
  for (const side of ["left", "right"]) {
    const wall = capture.outputs[side].wall;
    expect(wall.placements.map((item) => item.output).sort()).toEqual(["left", "right"]);
    expect(wall.coverageIdentity).toEqual({
      left: "fixture-coverage-left",
      right: "fixture-coverage-right",
    });
  }
  expect(validateCapture(capture, { artifacts: completeCaptureArtifacts(capture) })).toEqual([]);
});

test("rejects a string coverageIdentity when the object form is required", () => {
  const capture = completeCaptureFixture();
  capture.outputs.left.wall.coverageIdentity = "fixture-coverage";
  expect(validateCapture(capture, { artifacts: completeCaptureArtifacts(capture) })).toContain(
    "outputs.left.wall.coverageIdentity",
  );
});

test("rejects wall pages stored as an array", () => {
  const capture = completeCaptureFixture();
  capture.outputs.left.wall.pages = [{ left: 0, right: 100, y0: 0, y1: 40 }];
  expect(validateCapture(capture)).toContain("outputs.left.wall.pages");
});

test("rejects a wall whose present fields are empty or non-positive", () => {
  const capture = completeCaptureFixture();
  capture.outputs.left.wall.placements = [];
  capture.outputs.left.wall.logicalPlane = { width: 0, height: 0 };
  capture.outputs.left.wall.effectiveFont = 0;
  capture.outputs.left.wall.diagnostics = {};
  const errors = validateCapture(capture);
  expect(errors).toEqual(expect.arrayContaining([
    "outputs.left.wall.placements",
    "outputs.left.wall.logicalPlane",
    "outputs.left.wall.effectiveFont",
    "outputs.left.wall.diagnostics",
  ]));

  const omitted = completeCaptureFixture();
  omitted.outputs.right.wall = { headingDeg: 35 };
  expect(validateCapture(omitted)).toEqual(expect.arrayContaining([
    "outputs.right.wall.placements",
    "outputs.right.wall.logicalPlane",
    "outputs.right.wall.effectiveFont",
  ]));
});

test("rejects wall pages unless namesWall.activeMode is wall", () => {
  const pages = {
    left: { left: 0, right: 960, y0: 40, y1: 500 },
    right: { left: 960, right: 1920, y0: 40, y1: 500 },
  };
  const namesWall = (activeMode) => ({
    activeMode,
    innerEdgeInsetPx: { left: 0, right: 0 },
    profiles: {
      wall: { requestedFontPx: 12, spacingPx: 2, edgeInsetPx: 0, inwardShiftPercent: 0 },
      model: { requestedFontPx: 7, spacingPx: 0, edgeInsetPx: 0 },
    },
  });
  const withPages = (capture, activeMode) => {
    const config = capture.calibration.config;
    if (activeMode === undefined) {
      delete config.namesWall;
      config.schemaVersion = 2;
    } else {
      config.schemaVersion = 5;
      config.namesWall = namesWall(activeMode);
    }
    for (const side of ["left", "right"]) capture.outputs[side].wall.pages = structuredClone(pages);
    return validateCapture(capture, { artifacts: completeCaptureArtifacts(capture) });
  };

  expect(withPages(completeCaptureFixture(), "model")).toEqual(expect.arrayContaining([
    "outputs.left.wall.pages",
    "outputs.right.wall.pages",
  ]));
  expect(withPages(completeCaptureFixture(), undefined)).toEqual(expect.arrayContaining([
    "outputs.left.wall.pages",
    "outputs.right.wall.pages",
  ]));
  expect(withPages(completeCaptureFixture(), "wall")).toEqual([]);
});
