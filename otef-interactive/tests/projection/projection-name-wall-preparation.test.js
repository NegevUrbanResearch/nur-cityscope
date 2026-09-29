import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { createProjectionNameCanvasAdapter } from '../../frontend/src/projection/projection-name-canvas-adapter.js';
import { createProjectionSettlementNameAdapter } from '../../frontend/src/projection/projection-settlement-name-adapter.js';
import { disposeProjectionNameWallPreparation, prepareProjectionNameWall } from '../../frontend/src/shared/nli-name-field-data.js';
import { computeNameFieldWorkerResult } from '../../frontend/src/shared/nli-name-field-worker.js';
import { migrateNamesWallToV6 } from '../../frontend/src/shared/nli-name-wall-config.js';
import { evaluateNameWallCoverage, rectCoveredByPieces } from '../../frontend/src/shared/nli-name-wall-coverage.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { createFullFrameProjectionMesh } from '../../frontend/src/shared/projection-warp-geometry.js';

const MEMORIAL = new Set(['Murdered', 'Killed on duty', 'Murdered in captivity']);
const peoplePath = fileURLToPath(new URL('../../public/processed/layers/nli/people_names.geojson', import.meta.url));
const people = JSON.parse(readFileSync(peoplePath, 'utf8'));
const features = people.features.filter((feature) => MEMORIAL.has(feature.properties?.status)).slice(0, 16);
const meshes = {
  left: createFullFrameProjectionMesh({ side: 'left' }),
  right: createFullFrameProjectionMesh({ side: 'right' }),
};
const model = {
  west: 34.2, south: 31.2, east: 34.8, north: 31.7,
  bounds_polygon: [{ x: 34.2, y: 31.2 }, { x: 34.8, y: 31.2 }, { x: 34.8, y: 31.7 }, { x: 34.2, y: 31.7 }],
};
const tkuma = {
  type: 'FeatureCollection',
  crs: { properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
  features: [{ geometry: { type: 'LineString', coordinates: [[34.2, 31.2], [34.8, 31.2], [34.8, 31.7], [34.2, 31.7], [34.2, 31.2]] } }],
};

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

function canvasDocument() {
  const paints = [];
  const blits = [];
  const document = {
    fonts: { load: vi.fn(async () => [{ family: 'Guttman Hatzvi', status: 'loaded' }]) },
    paints,
    blits,
    createElement() {
      const canvas = { width: 0, height: 0, getContext: () => context };
      let paintedText = null;
      const context = {
        font: '', direction: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '',
        lineWidth: 0, lineJoin: '', globalAlpha: 1,
        save() {}, restore() {}, setTransform() {}, clearRect() {}, translate() {}, rotate() {},
        measureText(text) {
          const size = Number(String(context.font).match(/(\d+(?:\.\d+)?)px/)?.[1] || 12);
          const width = Math.max(8, [...String(text)].length * size * 0.45);
          return {
            width,
            actualBoundingBoxLeft: width / 2,
            actualBoundingBoxRight: width / 2,
            actualBoundingBoxAscent: size * 0.7,
            actualBoundingBoxDescent: size * 0.2,
          };
        },
        fillText(text, x, y) {
          paintedText = text;
          paints.push({ canvas, text, x, y });
        },
        strokeText(text, x, y) {
          paintedText = text;
          paints.push({ canvas, text, x, y });
        },
        drawImage(source, x, y) { blits.push({ canvas, source, x, y }); },
        getImageData() {
          const data = new Uint8ClampedArray(Math.max(1, canvas.width) * Math.max(1, canvas.height) * 4);
          if (paintedText && canvas.width > 0 && canvas.height > 0) {
            const metrics = context.measureText(paintedText);
            const inkWidth = Math.max(1, Math.round(metrics.width));
            const inkHeight = Math.max(1, Math.round(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent));
            const left = Math.max(0, Math.floor((canvas.width - inkWidth) / 2));
            const top = Math.max(0, Math.floor((canvas.height - inkHeight) / 2));
            for (let y = top; y < Math.min(canvas.height, top + inkHeight); y += 1) {
              for (let x = left; x < Math.min(canvas.width, left + inkWidth); x += 1) data[(y * canvas.width + x) * 4 + 3] = 255;
            }
          }
          return { data, width: canvas.width, height: canvas.height };
        },
      };
      return canvas;
    },
  };
  return document;
}

function wallConfig(rotateDeg) {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.namesWall.rotateDeg = rotateDeg;
  return config;
}

function logicalPlaneOf(config) {
  return {
    heading: config.namesWall.rotateDeg,
    planeScale: config.pre.scale * Math.min(config.outputs.left.post.scale, config.outputs.right.post.scale),
  };
}

const round6 = (value) => Math.round(value * 1e6) / 1e6;
const roundedPlacements = (field) => field.placements.map((item) => ({
  id: item.id, output: item.output, x: round6(item.x), y: round6(item.y),
  width: round6(item.width), height: round6(item.height),
}));
const membership = (field) => field.placements.map((item) => [item.id, item.output]);
const roundedCoverage = (coverage) => ({
  left: coverage.pieces.left.map((piece) => piece.polygon.map(([x, y]) => [round6(x), round6(y)])),
  right: coverage.pieces.right.map((piece) => piece.polygon.map(([x, y]) => [round6(x), round6(y)])),
  identities: coverage.outputIdentities,
});

class SameThreadNameFieldWorker {
  terminate() { this.terminated = true; }
  postMessage(data) {
    computeNameFieldWorkerResult(data).then((field) => {
      if (!this.terminated) this.onmessage?.({ data: { field } });
    }, (error) => {
      if (!this.terminated) this.onmessage?.({ data: { error: error.message } });
    });
  }
}

function installFetch() {
  globalThis.Worker = SameThreadNameFieldWorker;
  globalThis.proj4 = vi.fn((_from, _to, point) => point);
  globalThis.fetch = vi.fn((url) => {
    const href = String(url);
    if (href.includes('model-bounds')) return jsonResponse(model);
    if (href.includes('people_names')) return jsonResponse({ type: 'FeatureCollection', features });
    if (href.includes('release-metadata')) return jsonResponse({ datasetVersion: 'people-slice' });
    if (href.includes('Tkuma_Area')) return jsonResponse(tkuma);
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

function prepare(config) {
  return prepareProjectionNameWall({ config, meshes, datasetVersion: 'people-slice' });
}

afterEach(() => {
  disposeProjectionNameWallPreparation();
});

test('config rotation recomputes coverage and repacks through projection preparation', async () => {
  const document = canvasDocument();
  globalThis.document = document;
  installFetch();
  const frames = [];
  const previousFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };

  const settlementSettings = {
    baseline: {
      captureId: 'fixture-settlement-name', captureDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64),
      catalogDigest: 'c'.repeat(64),
      predecessor: { revision: 1, configDigest: 'd'.repeat(64) },
      successor: { revision: 2, configDigest: 'e'.repeat(64) },
      outputs: { left: { '0067': { x: 500, y: 340 } }, right: { '0067': { x: 1400, y: 360 } } },
    },
    style: { fontFamily: 'Guttman Hatzvi', fontPx: 14, rotateDeg: 35 },
    outputs: { left: {}, right: {} },
  };
  const settlement = createProjectionSettlementNameAdapter({ document, output: 'left' });
  await settlement.prepare({
    catalog: { entries: [{ citycode: '0067', text: 'נירים', lng: 34.4, lat: 31.3 }] },
    settings: settlementSettings,
  });
  settlement.commit();
  const settlementBefore = {
    source: settlement.descriptor().source,
    labels: settlement.getLabels(),
    style: structuredClone(settlementSettings.style),
    paints: document.paints.map((paint) => ({ canvas: paint.canvas, text: paint.text, x: paint.x, y: paint.y })),
    blits: document.blits.map((blit) => ({ ...blit })),
  };

  const seeded = wallConfig(35);
  const againConfig = wallConfig(35);
  const first = await prepare(seeded);
  const again = await prepare(againConfig);
  const seededCoverage = evaluateNameWallCoverage({ config: seeded, meshes, logicalPlane: logicalPlaneOf(seeded) });
  expect(again.digest).toBe(first.digest);
  expect(again.placements).toEqual(first.placements);
  expect(first.logicalPlane).toEqual(logicalPlaneOf(seeded));
  expect(first.diagnostics.effectiveFontPx).toBe(first.fontSize);
  expect(first.diagnostics.invalidCoverage).toBe(0);
  for (const item of first.placements) expect(rectCoveredByPieces(item, seededCoverage.pieces[item.output])).toBe(true);

  const legacy = structuredClone(DEFAULT_PROJECTION_CONFIG);
  delete legacy.namesWall.rotateDeg;
  legacy.schemaVersion = 5;
  const migrated395 = migrateNamesWallToV6(legacy, 395);
  const migrated270 = migrateNamesWallToV6(structuredClone(legacy), 270);
  expect(migrated395.namesWall.rotateDeg).toBe(35);
  expect(migrated270.namesWall.rotateDeg).toBe(-90);
  const raw395 = await prepare(wallConfig(395));
  const normalized35 = await prepare(migrated395);
  const raw270 = await prepare(wallConfig(270));
  const normalized90 = await prepare(migrated270);
  const coverage395 = roundedCoverage(evaluateNameWallCoverage({ config: wallConfig(395), meshes, logicalPlane: logicalPlaneOf(wallConfig(395)) }));
  const coverage35 = roundedCoverage(evaluateNameWallCoverage({ config: migrated395, meshes, logicalPlane: logicalPlaneOf(migrated395) }));
  const coverage270 = roundedCoverage(evaluateNameWallCoverage({ config: wallConfig(270), meshes, logicalPlane: logicalPlaneOf(wallConfig(270)) }));
  const coverage90 = roundedCoverage(evaluateNameWallCoverage({ config: migrated270, meshes, logicalPlane: logicalPlaneOf(migrated270) }));
  expect(raw395.digest).not.toBe(normalized35.digest);
  expect(raw270.digest).not.toBe(normalized90.digest);
  expect(coverage395).toEqual(coverage35);
  expect(coverage270).toEqual(coverage90);
  expect(roundedPlacements(raw395)).toEqual(roundedPlacements(normalized35));
  expect(roundedPlacements(raw270)).toEqual(roundedPlacements(normalized90));
  expect(membership(raw395)).toEqual(membership(normalized35));
  expect(membership(raw270)).toEqual(membership(normalized90));
  expect(raw395.diagnostics.effectiveFontPx).toBe(normalized35.diagnostics.effectiveFontPx);
  expect(raw270.diagnostics.effectiveFontPx).toBe(normalized90.diagnostics.effectiveFontPx);
  expect(normalized35.digest).toBe(first.digest);
  expect(normalized35.placements).toEqual(first.placements);

  const turned = wallConfig(70);
  const rotated = await prepare(turned);
  const rotatedCoverage = evaluateNameWallCoverage({ config: turned, meshes, logicalPlane: logicalPlaneOf(turned) });
  expect(rotated.logicalPlane.heading).toBe(70);
  expect(roundedCoverage(rotatedCoverage)).not.toEqual(coverage35);
  expect(roundedPlacements(rotated)).not.toEqual(roundedPlacements(first));
  expect(rotated.digest).not.toBe(first.digest);
  for (const item of rotated.placements) expect(rectCoveredByPieces(item, rotatedCoverage.pieces[item.output])).toBe(true);
  expect(rotated.diagnostics.effectiveFontPx).toBe(rotated.fontSize);

  const adapter = createProjectionNameCanvasAdapter({ document, output: 'left' });
  adapter.prepare({
    config: turned, placements: rotated.placements, fontPx: rotated.fontSize, logicalPlane: rotated.logicalPlane,
  });
  adapter.commit();
  const owned = rotated.placements.find((item) => item.output === 'left');
  expect(document.paints.some((paint) => paint.text === owned.name && paint.x === owned.x && paint.y === owned.y)).toBe(true);
  expect(adapter.descriptor().opacity).toBe(0);
  expect(adapter.descriptor().revealSeconds).toBe(0);
  expect(frames).toEqual([]);
  expect(settlement.descriptor().source).toBe(settlementBefore.source);
  expect(settlement.getLabels()).toEqual(settlementBefore.labels);
  expect(settlementSettings.style).toEqual(settlementBefore.style);
  expect(document.paints.slice(0, settlementBefore.paints.length)).toEqual(settlementBefore.paints);
  expect(document.blits).toEqual(settlementBefore.blits);
  globalThis.requestAnimationFrame = previousFrame;
});
