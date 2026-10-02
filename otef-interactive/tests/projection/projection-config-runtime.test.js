import { describe, expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createProjectionConfigRuntime } from "../../frontend/src/projection/projection-config-runtime.js";
import { projectionPlacementInputIdentity } from "../../frontend/src/projection/projection-names-run.js";
import { applyProjectionSpanView } from "../../frontend/src/projection/projection-span-view.js";
import { createNliNameFieldController } from "../../frontend/src/shared/nli-name-field-controller.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { createProjectionNameCanvasAdapter } from "../../frontend/src/projection/projection-name-canvas-adapter.js";

function makeHarness(spanId = "left", instanceId = "11111111-1111-4111-8111-111111111111", options = {}) {
  let listener;
  const queued = [];
  const sent = [];
  const renderListeners = new Set();
  const errorListeners = new Set();
  const socketListeners = new Map();
  const applied = [];
  const client = {
    subscribe(fn) { listener = fn; fn({ snapshot: null }); return () => { listener = null; }; },
    start: vi.fn(() => Promise.resolve()),
    getState: () => ({ snapshot: null }),
  };
  const socket = {
    on: (name, fn) => { socketListeners.set(name, fn); },
    off: (name) => { socketListeners.delete(name); },
    send: (message) => { sent.push(message); return true; },
  };
  const map = {
    on: (name, fn) => { if (name === "render") renderListeners.add(fn); if (name === "error") errorListeners.add(fn); },
    off: (name, fn) => { if (name === "render") renderListeners.delete(fn); if (name === "error") errorListeners.delete(fn); },
    triggerRepaint: vi.fn(),
    getEffectiveProjectionConfig: () => options.initialConfig || DEFAULT_PROJECTION_CONFIG,
  };
  const runtime = createProjectionConfigRuntime({
    map, spanId, client, socket, instanceId,
      requestFrame: (fn) => { queued.push(fn); return queued.length; },
      cancelFrame: vi.fn(),
      applyConfig: (config, revision, geometryPair) => { applied.push({ config, revision, geometryPair }); options.applyConfig?.(config, revision, { render: () => [...renderListeners].forEach((fn) => fn()) }); },
      drawCompletion: options.drawCompletion,
      route: options.route,
      baseline: options.baseline,
      prepareGeometry: options.prepareGeometry,
      rollbackGeometry: options.rollbackGeometry,
      finalizeGeometry: options.finalizeGeometry,
      prepareCandidate: options.prepareCandidate,
      commitCandidate: options.commitCandidate,
      rollbackCandidate: options.rollbackCandidate,
      finalizeCandidate: options.finalizeCandidate,
      isWallEnabled: options.isWallEnabled,
      getDatasetVersion: options.getDatasetVersion,
      getDatasetIdentityError: options.getDatasetIdentityError,
      clock: options.clock,
  });
  return {
    runtime,
    state(revision, config = DEFAULT_PROJECTION_CONFIG) { listener?.({ snapshot: { revision, config } }); },
    frame() { queued.shift()?.(); },
    render(event = {}) { [...renderListeners].forEach((fn) => fn(event)); },
    error(event = {}) { [...errorListeners].forEach((fn) => fn(event)); },
    sent: () => sent,
    applied,
    socketListeners,
    map,
    renderListeners,
    errorListeners,
  };
}

function spanNode(id) {
  return {
    id, style: {}, dataset: {}, clientWidth: 1600, clientHeight: 900, children: [], parentElement: null,
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentElement = null; return child; },
    querySelector(selector) { return this.id === selector.slice(1) ? this : this.children.map((child) => child.querySelector(selector)).find(Boolean) || null; },
  };
}

function realSpanAndNames() {
  const display = spanNode("displayContainer");
  const image = spanNode("displayedImage");
  const container = spanNode("projectionMap");
  display.appendChild(image); display.appendChild(container);
  globalThis.document = { createElement: () => spanNode("") };
  const map = createFakeMapLibreMap();
  let camera = { center: { lng: 34.5, lat: 31.5 }, zoom: 10, bearing: 7, pitch: 0, padding: 0 };
  map.getContainer = () => container;
  const canvas = { style: {} };
  map.getCanvas = () => canvas;
  map.getCenter = () => camera.center;
  map.getZoom = () => camera.zoom;
  map.getMaxZoom = () => 22;
  map.getBearing = () => camera.bearing;
  map.getPitch = () => camera.pitch;
  map.getPadding = () => camera.padding;
  map.unproject = ([x, y]) => ({ lng: camera.center.lng + (x - 800) / 1000, lat: camera.center.lat + (y - 450) / 1000 });
  map.jumpTo = (next) => { camera = { ...camera, ...next, zoom: Math.min(22, next.zoom ?? camera.zoom) }; };
  const controller = createNliNameFieldController({ map, context: { subscribe: () => () => {}, getPersonSelection: () => null }, projectionSpan: "left" });
  let effective = DEFAULT_PROJECTION_CONFIG;
  map.getEffectiveProjectionConfig = () => effective;
  map.setEffectiveProjectionConfig = (config, revision) => {
    if (Number.isFinite(map._otefProjectionSpanRevision) && revision < map._otefProjectionSpanRevision) return false;
    effective = config;
    return applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config, revision });
  };
  return { map, controller, image, container, canvas, getCamera: () => ({ ...camera }), getEffective: () => effective };
}

describe("projection config runtime", () => {
  test('abandoned geometry restores consumers before a newer mesh preparation fails', async () => {
    let visibleConfig;
    const h = makeHarness('left', undefined, {
      prepareGeometry: async (_config, revision) => {
        if (revision === 3) throw new Error('invalid peer mesh');
        return { revision };
      },
      rollbackGeometry: vi.fn(), drawCompletion: () => true,
      applyConfig: (config) => { visibleConfig = config; },
    });
    const first = structuredClone(DEFAULT_PROJECTION_CONFIG);
    const second = structuredClone(first); second.pre.scale += 0.1;
    const third = structuredClone(second); third.pre.scale += 0.1;
    await h.runtime.start(); h.state(1, first); h.frame();
    await vi.waitFor(() => expect(h.applied).toHaveLength(1)); h.render();
    h.state(2, second); h.frame();
    await vi.waitFor(() => expect(visibleConfig).toEqual(second));
    h.state(3, third); h.frame();
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 3, success: false })));
    expect(visibleConfig).toEqual(first);
    h.runtime.stop();
  });

  test('real names controller restores completed glyphs before newer geometry after render resolution', async () => {
    const { controller } = realSpanAndNames();
    const adapter = createProjectionNameCanvasAdapter({ output: 'left', document: { createElement: () => {
      const ctx = { save() {}, restore() {}, setTransform() {}, clearRect() {}, fillText: vi.fn(), strokeText() {} };
      return { getContext: () => ctx, ctx };
    } } });
    controller.installProjectionCanvas(adapter);
    let builds = 0;
    const h = makeHarness('left', undefined, {
      drawCompletion: () => true, getDatasetVersion: () => 'v1',
      applyConfig: (config, revision) => controller.applyProjectionConfigGeometry(config, revision),
      prepareCandidate: async (config, revision, generation, signal) => {
        const name = ++builds === 1 ? 'Completed' : 'Cancelled';
        const feature = { type: 'Feature', properties: { pid: 'one', name, visible_spans: ['left'] }, geometry: { type: 'Point', coordinates: [34.5, 31.5] } };
        const field = { datasetVersion: 'v1', digest: 'a'.repeat(64), fontSize: 12,
          geojson: { type: 'FeatureCollection', features: [feature] }, byPid: new Map([['one', { feature }]]),
          placements: [{ id: 'one', name, output: 'left', x: 0, y: 0, width: 20, height: 10 }],
          logicalPlane: { heading: 17, planeScale: 1 },
          diagnostics: { state: 'valid', expected: 1, placed: 1, missing: 0, extra: 0, duplicate: 0 } };
        const wall = await controller.prepareProjectionCandidate({ config, revision, generation, signal, field });
        return { wall, generation };
      },
      commitCandidate: (pair) => controller.commitProjectionCandidate(pair.generation),
      rollbackCandidate: (pair) => controller.rollbackProjectionCandidate(pair.generation),
      finalizeCandidate: (pair) => controller.finalizeProjectionCandidate(pair.generation),
    });
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(1, config); h.frame(); h.render();
    await vi.waitFor(() => expect(adapter.descriptor()).not.toBeNull()); h.render();
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({ state: 'current' })));
    const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    h.socketListeners.get('otef_projection_names_run')({ type: 'otef_projection_names_run', table: 'otef', requestId,
      revision: 1, datasetVersion: 'v1', placementIdentity: await projectionPlacementInputIdentity(config) });
    await vi.waitFor(() => expect(adapter.descriptor().source.ctx.fillText).toHaveBeenCalledWith('Cancelled', 0, 0));
    const next = structuredClone(config); next.outputs.left.crop.x1 = 0.65;
    let superseded = false;
    h.map.on('render', () => { if (!superseded) { superseded = true; h.state(2, next); h.frame(); } });
    h.render();
    await Promise.resolve(); await Promise.resolve();
    expect(adapter.descriptor().source.ctx.fillText).toHaveBeenCalledWith('Completed', 0, 0);
    expect(adapter.descriptor().source.ctx.fillText).not.toHaveBeenCalledWith('Cancelled', 0, 0);
    expect(controller.getProjectionNameDiagnostics()).toMatchObject({ installedRevision: 1, requestedRevision: 2 });
    h.runtime.stop(); controller.dispose();
  });

  test('geometry revisions retain the installed names and do not schedule placement work', async () => {
    let visibleWall = 'initial';
    const prepare = vi.fn(async () => ({ wall: { datasetVersion: 'v1', digest: 'a'.repeat(64), diagnostics: { expected: 2, placed: 2 } } }));
    const commit = vi.fn((pair) => { visibleWall = pair.wall.digest; });
    const rollback = vi.fn(() => { visibleWall = 'initial'; });
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate: prepare, commitCandidate: commit, rollbackCandidate: rollback, drawCompletion: () => true,
      getDatasetVersion: () => 'v1',
    });
    await h.runtime.start(); h.state(1); h.frame(); h.render();
    await vi.waitFor(() => expect(visibleWall).toBe('a'.repeat(64)));
    h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((item) => item.type === 'otef_projection_names_status' && item.state === 'current')).toBe(true));
    const next = structuredClone(DEFAULT_PROJECTION_CONFIG); next.outputs.left.post.scale += 0.1;
    h.state(2, next); h.frame(); h.render();
    expect(prepare).toHaveBeenCalledOnce();
    expect(visibleWall).toBe('a'.repeat(64));
    await vi.waitFor(() => expect(h.sent().some((item) => item.type === 'otef_projection_names_status' && item.state === 'stale' && item.revision === 2)).toBe(true));
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_applied', revision: 2, success: true }));
    h.runtime.stop();
  });

  test('an explicit names run is idempotent and commits only for its current applied target', async () => {
    const prepared = { wall: { datasetVersion: 'v1', digest: 'b'.repeat(64), diagnostics: { expected: 2, placed: 2 } } };
    const prepare = vi.fn(async () => prepared); const commit = vi.fn(); const rollback = vi.fn();
    const h = makeHarness('right', '22222222-2222-4222-8222-222222222222', {
      prepareCandidate: prepare, commitCandidate: commit, rollbackCandidate: rollback, drawCompletion: () => true,
      getDatasetVersion: () => 'v1',
    });
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(7, config); h.frame(); h.render();
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((item) => item.type === 'otef_projection_names_status' && item.state === 'current')).toBe(true));
    const requestId = '33333333-3333-4333-8333-333333333333';
    const identity = await projectionPlacementInputIdentity(config);
    const command = { type: 'otef_projection_names_run', table: 'otef', requestId, revision: 7, datasetVersion: 'v1', placementIdentity: identity };
    const run = h.socketListeners.get('otef_projection_names_run');
    run(command); run(command);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((item) => item.type === 'otef_projection_names_status' && item.requestId === requestId && item.state === 'current')).toBe(true));
    expect(commit).toHaveBeenCalledTimes(2);
    h.runtime.stop();
  });

  test('cold-start wall failure leaves applied geometry usable and reconnect does not retry placement', async () => {
    const prepare = vi.fn(async () => { throw new Error('layout failed'); });
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate: prepare, drawCompletion: () => true, getDatasetVersion: () => 'v1',
    });
    await h.runtime.start(); h.state(4); h.frame(); h.render();
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect(h.applied).toHaveLength(1);
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_applied', revision: 4, success: true }));
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', state: 'failed' }));
    h.socketListeners.get('disconnect')(); h.socketListeners.get('connect')(); h.runtime.requestStatus();
    expect(prepare).toHaveBeenCalledOnce();
    h.runtime.stop();
  });

  test('dataset changes stale installed names without rebuilding until Run uses the new dataset', async () => {
    let version = 'v1';
    const prepare = vi.fn(async () => ({ wall: { datasetVersion: version, digest: (version === 'v1' ? 'a' : 'b').repeat(64), diagnostics: { expected: 2, placed: 2 } } }));
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate: prepare, commitCandidate: vi.fn(), drawCompletion: () => true, getDatasetVersion: () => version,
    });
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(8, config); h.frame(); h.render();
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((item) => item.type === 'otef_projection_names_status' && item.state === 'current')).toBe(true));
    version = 'v2'; h.runtime.datasetChanged();
    expect(prepare).toHaveBeenCalledOnce();
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', state: 'stale' }));
    const command = { type: 'otef_projection_names_run', table: 'otef', requestId: '44444444-4444-4444-8444-444444444444',
      revision: 8, datasetVersion: 'v2', placementIdentity: await projectionPlacementInputIdentity(config) };
    h.socketListeners.get('otef_projection_names_run')(command);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((item) => item.type === 'otef_projection_names_status' && item.requestId === command.requestId && item.state === 'current')).toBe(true));
    h.runtime.stop();
  });

  test('failed manual placement restores names only and keeps the latest geometry', async () => {
    let calls = 0;
    const rollback = vi.fn();
    const prepareCandidate = vi.fn(async () => {
      if (++calls === 1) return { wall: { datasetVersion: 'v1', digest: 'a'.repeat(64), diagnostics: { expected: 2, placed: 2 } } };
      return { wall: { datasetVersion: 'v1', digest: 'b'.repeat(64), diagnostics: { expected: 2, placed: 1 } } };
    });
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate, rollbackCandidate: rollback, drawCompletion: () => true, getDatasetVersion: () => 'v1',
    });
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(1, config); h.frame(); h.render();
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledOnce());
    h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((item) => item.type === 'otef_projection_names_status' && item.state === 'current')).toBe(true));
    const next = structuredClone(config); next.outputs.left.post.scale += 0.2;
    h.state(2, next); h.frame(); h.render();
    const requestId = '55555555-5555-4555-8555-555555555555';
    h.socketListeners.get('otef_projection_names_run')({ type: 'otef_projection_names_run', table: 'otef', requestId,
      revision: 2, datasetVersion: 'v1', placementIdentity: await projectionPlacementInputIdentity(next) });
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledTimes(2));
    h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((item) => item.type === 'otef_projection_names_status' && item.requestId === requestId && item.state === 'failed')).toBe(true));
    expect(h.applied.at(-1)).toMatchObject({ revision: 2, config: next });
    expect(rollback).toHaveBeenCalledWith(expect.anything(), expect.anything(), 2, { namesOnly: true });
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_applied', revision: 2, success: true }));
    h.runtime.stop();
  });

  test('paired mesh preparation gates geometry acknowledgement and leaves last good config on rejection', async () => {
    const prepareGeometry = vi.fn(async (_config, revision) => {
      if (revision === 2) throw new Error('peer mesh invalid');
      return { revision };
    });
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', { prepareGeometry, drawCompletion: () => true });
    const next = structuredClone(DEFAULT_PROJECTION_CONFIG); next.pre.scale += 0.1;
    await h.runtime.start(); h.state(1); h.frame();
    await vi.waitFor(() => expect(h.applied).toHaveLength(1));
    h.render();
    const invalid = structuredClone(next); invalid.pre.scale += 0.1;
    h.state(2, invalid); h.frame();
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_applied', revision: 2, success: false, error: 'peer mesh invalid' })));
    expect(h.applied.map(({ revision }) => revision)).toEqual([1]);
    h.runtime.stop();
  });

  test('equivalent placement inputs promote completed names only after the next geometry draw', async () => {
    const prepare = vi.fn(async () => ({ wall: { datasetVersion: 'v1', digest: 'a'.repeat(64), diagnostics: { expected: 2, placed: 2 } } }));
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate: prepare, drawCompletion: () => true, getDatasetVersion: () => 'v1',
    });
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(1, config); h.frame(); h.render();
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce()); h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', state: 'current', revision: 1 })));

    h.state(2, structuredClone(config)); h.frame();
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', state: 'stale', revision: 2 })));
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', state: 'stale', revision: 2,
      installed: expect.objectContaining({ revision: 1, digest: 'a'.repeat(64), expected: 2, placed: 2 }) }));
    expect(prepare).toHaveBeenCalledOnce();
    h.render();
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', state: 'current', revision: 2,
      installed: expect.objectContaining({ revision: 2, digest: 'a'.repeat(64), expected: 2, placed: 2 }) })));
    expect(prepare).toHaveBeenCalledOnce();
    h.runtime.stop();
  });

  test('rejected names runs return bounded status correlated to the immutable request target', async () => {
    const prepare = vi.fn(async () => ({ wall: { datasetVersion: 'accepted-release', digest: 'd'.repeat(64), diagnostics: { expected: 1, placed: 1 } } }));
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate: prepare, drawCompletion: () => true, getDatasetVersion: () => 'accepted-release',
    });
    await h.runtime.start(); h.state(3); h.frame(); h.render();
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce()); h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', state: 'current', revision: 3 })));
    const command = { type: 'otef_projection_names_run', table: 'otef', requestId: 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      revision: 3, datasetVersion: 'stale-release', placementIdentity: 'c'.repeat(64) };
    h.socketListeners.get('otef_projection_names_run')(command);
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({
      type: 'otef_projection_names_status', requestId: command.requestId, revision: command.revision,
      datasetVersion: command.datasetVersion, placementIdentity: command.placementIdentity, state: 'stale',
    })));
    expect(prepare).toHaveBeenCalledOnce();
    h.runtime.requestStatus();
    expect(h.sent().at(-1)).toMatchObject({ type: 'otef_projection_names_status', requestId: null, revision: 3,
      datasetVersion: 'accepted-release', state: 'current', installed: { revision: 3, digest: 'd'.repeat(64) } });
    h.runtime.stop();
  });

  test('accepted release identity load failure is reported after geometry succeeds', async () => {
    const prepare = vi.fn();
    const h = makeHarness('right', '22222222-2222-4222-8222-222222222222', {
      prepareCandidate: prepare, drawCompletion: () => true, getDatasetIdentityError: () => 'Name wall release metadata unavailable',
    });
    await h.runtime.start(); h.state(6); h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({
      type: 'otef_projection_names_status', state: 'failed', revision: 6,
      error: 'Name wall release metadata unavailable', placementIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
    })));
    await vi.waitFor(() => expect(h.sent().at(-1)).toMatchObject({
      type: 'otef_projection_names_status', state: 'failed', revision: 6,
      datasetVersion: '', error: 'Name wall release metadata unavailable', installed: null,
    }));
    h.runtime.requestStatus();
    expect(h.sent().at(-1)).toMatchObject({ type: 'otef_projection_names_status', state: 'failed', revision: 6,
      datasetVersion: '', error: 'Name wall release metadata unavailable', installed: null });
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_applied', revision: 6, success: true }));
    expect(h.sent().some((message) => message.type === 'otef_projection_names_status' && message.state === 'current')).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
    h.runtime.stop();
  });

  test('disconnect cancels an active names run into stale status and reconnect does not restart it', async () => {
    let resolveRun;
    let prepares = 0;
    const prepareCandidate = vi.fn(() => {
      prepares += 1;
      if (prepares === 1) return Promise.resolve({ wall: { datasetVersion: 'v1', digest: 'a'.repeat(64), diagnostics: { expected: 1, placed: 1 } } });
      return new Promise((resolve) => { resolveRun = resolve; });
    });
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate, commitCandidate: vi.fn(), drawCompletion: () => true, getDatasetVersion: () => 'v1',
    });
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(3, config); h.frame(); h.render();
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledOnce()); h.render();
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', state: 'current' })));
    const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    h.socketListeners.get('otef_projection_names_run')({ type: 'otef_projection_names_run', table: 'otef', requestId,
      revision: 3, datasetVersion: 'v1', placementIdentity: await projectionPlacementInputIdentity(config) });
    await vi.waitFor(() => expect(h.sent()).toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', state: 'rebuilding', requestId })));
    h.socketListeners.get('disconnect')();
    h.socketListeners.get('connect')();
    h.runtime.requestStatus();
    expect(h.sent().at(-1)).toMatchObject({ type: 'otef_projection_names_status', state: 'stale', requestId: null,
      installed: { revision: 3, datasetVersion: 'v1', digest: 'a'.repeat(64) } });
    expect(prepares).toBe(2);
    resolveRun({ wall: { datasetVersion: 'v1', digest: 'b'.repeat(64), diagnostics: { expected: 1, placed: 1 } } });
    await Promise.resolve(); await Promise.resolve();
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', requestId, state: 'current' }));
    h.runtime.stop();
  });

  test('geometry render failure restores every config consumer after rolling back the paired mesh', async () => {
    const rollbackGeometry = vi.fn();
    const consumers = { camera: null, labels: null, pattern: null };
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareGeometry: async (_config, revision) => ({ revision }), rollbackGeometry, drawCompletion: () => true,
      applyConfig: (config) => {
        consumers.camera = structuredClone(config);
        consumers.labels = structuredClone(config);
        consumers.pattern = structuredClone(config);
      },
    });
    const first = structuredClone(DEFAULT_PROJECTION_CONFIG);
    const second = structuredClone(first); second.pre.scale += 0.05;
    await h.runtime.start(); h.state(1, first); h.frame();
    await vi.waitFor(() => expect(h.applied).toHaveLength(1)); h.render();
    h.state(2, second); h.frame();
    await vi.waitFor(() => expect(h.applied).toHaveLength(2));
    h.error({ error: new Error('compositor draw failed') });
    expect(rollbackGeometry).toHaveBeenCalledWith({ revision: 2 }, first, 2);
    expect(h.applied.at(-1)).toMatchObject({ config: first, revision: 2 });
    expect(consumers).toEqual({ camera: first, labels: first, pattern: first });
    h.runtime.stop();
  });

  test('rejects a wrong-dataset names candidate before commit and keeps rollback available', async () => {
    let prepares = 0;
    const commit = vi.fn(); const rollback = vi.fn(); const finalize = vi.fn();
    const prepareCandidate = vi.fn(async () => ({ wall: { datasetVersion: ++prepares === 1 ? 'v1' : 'v2',
      digest: (prepares === 1 ? 'a' : 'b').repeat(64), diagnostics: { expected: 2, placed: 2 } } }));
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate, commitCandidate: commit, rollbackCandidate: rollback, finalizeCandidate: finalize,
      drawCompletion: () => true, getDatasetVersion: () => 'v1',
    });
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(1, config); h.frame(); h.render();
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledOnce()); h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((x) => x.type === 'otef_projection_names_status' && x.state === 'current')).toBe(true));
    const requestId = '66666666-6666-4666-8666-666666666666';
    h.socketListeners.get('otef_projection_names_run')({ type: 'otef_projection_names_run', table: 'otef', requestId,
      revision: 1, datasetVersion: 'v1', placementIdentity: await projectionPlacementInputIdentity(config) });
    await vi.waitFor(() => expect(h.sent().some((x) => x.type === 'otef_projection_names_status' && x.requestId === requestId && x.state === 'failed')).toBe(true));
    expect(commit).toHaveBeenCalledOnce();
    expect(finalize).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1, { namesOnly: true });
    h.runtime.stop();
  });

  test('invalidation cancels a committed names candidate before a later render can confirm it', async () => {
    let prepares = 0;
    const prepareCandidate = vi.fn(async () => ({ wall: { datasetVersion: 'v1', digest: (++prepares).toString(16).padStart(64, 'a'), diagnostics: { expected: 2, placed: 2 } } }));
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate, commitCandidate: vi.fn(), finalizeCandidate: vi.fn(), drawCompletion: () => true, getDatasetVersion: () => 'v1',
    });
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(1, config); h.frame(); h.render();
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledOnce()); h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((x) => x.type === 'otef_projection_names_status' && x.state === 'current')).toBe(true));
    const requestId = '77777777-7777-4777-8777-777777777777';
    h.socketListeners.get('otef_projection_names_run')({ type: 'otef_projection_names_run', table: 'otef', requestId,
      revision: 1, datasetVersion: 'v1', placementIdentity: await projectionPlacementInputIdentity(config) });
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledTimes(2));
    h.runtime.invalidate(); h.render();
    await Promise.resolve(); await Promise.resolve();
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', requestId, state: 'current' }));
    h.runtime.stop();
  });

  test('cold geometry applies without dataset identity and retries one name build when identity arrives', async () => {
    let version = null;
    const prepareCandidate = vi.fn(async () => ({ wall: { datasetVersion: 'v1', digest: 'c'.repeat(64), diagnostics: { expected: 1, placed: 1 } } }));
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', { prepareCandidate, drawCompletion: () => true, getDatasetVersion: () => version });
    await h.runtime.start(); h.state(1); h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((x) => x.type === 'otef_projection_names_status' && /Waiting/.test(x.error || ''))).toBe(true));
    expect(h.applied).toHaveLength(1);
    expect(prepareCandidate).not.toHaveBeenCalled();
    version = 'v1';
    expect(h.runtime.datasetChanged()).toBe(true);
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledOnce());
    h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((x) => x.type === 'otef_projection_names_status' && x.state === 'current')).toBe(true));
    h.socketListeners.get('disconnect')(); h.socketListeners.get('connect')(); h.runtime.requestStatus();
    expect(prepareCandidate).toHaveBeenCalledOnce();
    h.runtime.stop();
  });

  test('a Run target is rechecked after async identity calculation before placement starts', async () => {
    let prepares = 0;
    const prepareCandidate = vi.fn(async () => ({ wall: { datasetVersion: 'v1', digest: (++prepares).toString(16).padStart(64, 'a'), diagnostics: { expected: 1, placed: 1 } } }));
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', { prepareCandidate, drawCompletion: () => true, getDatasetVersion: () => 'v1' });
    const first = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(1, first); h.frame(); h.render();
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledOnce()); h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((x) => x.type === 'otef_projection_names_status' && x.state === 'current')).toBe(true));
    const firstIdentity = await projectionPlacementInputIdentity(first);
    const second = structuredClone(first); second.pre.scale += 0.02;
    const secondIdentity = await projectionPlacementInputIdentity(second);
    const deferredDigests = [];
    vi.stubGlobal('crypto', { subtle: { digest: () => new Promise((resolve) => deferredDigests.push(resolve)) } });
    try {
      const requestId = '88888888-8888-4888-8888-888888888888';
      h.socketListeners.get('otef_projection_names_run')({ type: 'otef_projection_names_run', table: 'otef', requestId,
        revision: 1, datasetVersion: 'v1', placementIdentity: firstIdentity });
      await vi.waitFor(() => expect(deferredDigests).toHaveLength(1));
      h.state(2, second); h.frame(); h.render();
      await vi.waitFor(() => expect(deferredDigests).toHaveLength(2));
      deferredDigests[1](Uint8Array.from(secondIdentity.match(/../g), (byte) => Number.parseInt(byte, 16)).buffer);
      await Promise.resolve();
      deferredDigests[0](Uint8Array.from(firstIdentity.match(/../g), (byte) => Number.parseInt(byte, 16)).buffer);
      await Promise.resolve(); await Promise.resolve();
      expect(prepareCandidate).toHaveBeenCalledOnce();
      expect(h.sent()).not.toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', requestId, state: 'rebuilding' }));
    } finally { vi.unstubAllGlobals(); }
    h.runtime.stop();
  });

  test('run candidate target is rechecked after its async identity hash before commit', async () => {
    let prepares = 0; let resolveCandidate;
    const prepareCandidate = vi.fn(() => {
      if (++prepares === 1) return Promise.resolve({ wall: { datasetVersion: 'v1', digest: 'a'.repeat(64), diagnostics: { expected: 1, placed: 1 } } });
      return new Promise((resolve) => { resolveCandidate = resolve; });
    });
    const commitCandidate = vi.fn(); const rollbackCandidate = vi.fn();
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate, commitCandidate, rollbackCandidate, drawCompletion: () => true, getDatasetVersion: () => 'v1',
    });
    const first = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(1, first); h.frame(); h.render();
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledOnce()); h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((x) => x.type === 'otef_projection_names_status' && x.state === 'current')).toBe(true));
    const firstIdentity = await projectionPlacementInputIdentity(first);
    const second = structuredClone(first); second.pre.scale += 0.03;
    const secondIdentity = await projectionPlacementInputIdentity(second);
    const deferredDigests = [];
    vi.stubGlobal('crypto', { subtle: { digest: () => new Promise((resolve) => deferredDigests.push(resolve)) } });
    const bytes = (hash) => Uint8Array.from(hash.match(/../g), (byte) => Number.parseInt(byte, 16)).buffer;
    try {
      h.socketListeners.get('otef_projection_names_run')({ type: 'otef_projection_names_run', table: 'otef',
        requestId: '99999999-9999-4999-8999-999999999999', revision: 1, datasetVersion: 'v1', placementIdentity: firstIdentity });
      await vi.waitFor(() => expect(deferredDigests).toHaveLength(1)); deferredDigests[0](bytes(firstIdentity));
      await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledTimes(2));
      resolveCandidate({ wall: { datasetVersion: 'v1', digest: 'b'.repeat(64), diagnostics: { expected: 1, placed: 1 } } });
      await vi.waitFor(() => expect(deferredDigests).toHaveLength(2));
      h.state(2, second); h.frame(); h.render();
      await vi.waitFor(() => expect(deferredDigests).toHaveLength(3)); deferredDigests[2](bytes(secondIdentity));
      await Promise.resolve(); deferredDigests[1](bytes(firstIdentity));
      await Promise.resolve(); await Promise.resolve();
      expect(commitCandidate).toHaveBeenCalledOnce();
      expect(h.sent()).not.toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', requestId: '99999999-9999-4999-8999-999999999999', state: 'current' }));
    } finally { vi.unstubAllGlobals(); }
    h.runtime.stop();
  });

  test('geometry superseding the completed candidate render prevents finalize and current status', async () => {
    let prepares = 0;
    const prepareCandidate = vi.fn(async () => ({ wall: { datasetVersion: 'v1', digest: (++prepares).toString(16).padStart(64, 'a'), diagnostics: { expected: 1, placed: 1 } } }));
    const commitCandidate = vi.fn(); const rollbackCandidate = vi.fn(); const finalizeCandidate = vi.fn();
    const h = makeHarness('left', '11111111-1111-4111-8111-111111111111', {
      prepareCandidate, commitCandidate, rollbackCandidate, finalizeCandidate, drawCompletion: () => true, getDatasetVersion: () => 'v1',
    });
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    await h.runtime.start(); h.state(1, config); h.frame(); h.render();
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledOnce()); h.frame(); h.render();
    await vi.waitFor(() => expect(h.sent().some((x) => x.type === 'otef_projection_names_status' && x.state === 'current')).toBe(true));
    const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    h.socketListeners.get('otef_projection_names_run')({ type: 'otef_projection_names_run', table: 'otef', requestId,
      revision: 1, datasetVersion: 'v1', placementIdentity: await projectionPlacementInputIdentity(config) });
    await vi.waitFor(() => expect(prepareCandidate).toHaveBeenCalledTimes(2));
    let superseded = false;
    h.map.on('render', () => {
      if (superseded) return;
      superseded = true;
      const next = structuredClone(config); next.outputs.right.post.scale += 0.01;
      h.state(2, next); h.frame(); h.render();
    });
    h.render();
    await Promise.resolve(); await Promise.resolve();
    expect(finalizeCandidate).toHaveBeenCalledOnce();
    expect(rollbackCandidate).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1, { namesOnly: true });
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ type: 'otef_projection_names_status', requestId, state: 'current' }));
    h.runtime.stop();
  });

  test("zoom-clamped revision rolls camera, mask, and image back and reports failure before recovery", async () => {
    const { map, controller, image, container, canvas, getCamera, getEffective } = realSpanAndNames();
    let listener;
    const queued = [];
    const sent = [];
    const client = { subscribe(fn) { listener = fn; fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() };
    const socket = { on() {}, off() {}, send: (message) => sent.push(message) };
    const applyConfig = (config, revision) => {
      if (map.setEffectiveProjectionConfig(config, revision) === false) throw new Error("camera rejected");
      if (!controller.setProjectionConfig(config, revision)) throw new Error("names rejected");
    };
    const runtime = createProjectionConfigRuntime({ map, spanId: "left", client, socket, applyConfig, instanceId: "11111111-1111-4111-8111-111111111111", requestFrame: (fn) => queued.push(fn), cancelFrame() {} });
    await runtime.start();
    listener({ snapshot: { revision: 1, config: DEFAULT_PROJECTION_CONFIG } }); queued.shift()(); map.emit("render");
    const lastGood = { camera: getCamera(), mask: container.style.clipPath, canvasMask: canvas.style.clipPath, imageClip: image.style.clipPath, imageTransform: image.style.transform };
    const extreme = structuredClone(DEFAULT_PROJECTION_CONFIG);
    extreme.pre.scale = 8;
    extreme.outputs.left.crop = { x0: 0, x1: 0.01, y0: 0, y1: 0.01 };
    extreme.outputs.left.post.scale = 8;
    listener({ snapshot: { revision: 2, config: extreme } }); queued.shift()();
    expect(getEffective()).toEqual(DEFAULT_PROJECTION_CONFIG);
    expect(getCamera()).toEqual(lastGood.camera);
    expect(container.style.clipPath).toBe(lastGood.mask);
    expect(canvas.style.clipPath).toBe(lastGood.canvasMask);
    expect(image.style.clipPath).toBe(lastGood.imageClip);
    expect(image.style.transform).toBe(lastGood.imageTransform);
    expect(sent).toContainEqual(expect.objectContaining({ revision: 2, success: false, error: expect.stringMatching(/camera zoom limit/i) }));
    const ordinary = structuredClone(DEFAULT_PROJECTION_CONFIG);
    ordinary.pre.tx = 0.02;
    listener({ snapshot: { revision: 3, config: ordinary } }); queued.shift()(); map.emit("render");
    expect(sent).toContainEqual(expect.objectContaining({ revision: 3, success: true }));
    runtime.stop(); controller.dispose();
  });
  test("coalesces revisions before a frame and acknowledges only after render", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(2);
    h.state(3);
    h.frame();
    expect(h.applied.map((item) => item.revision)).toEqual([3]);
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({
      type: "otef_projection_applied", revision: 3, success: true, output: "left",
    }));
  });

  test("browser acknowledgement waits for the completed compositor draw and carries route identity", async () => {
    let drawn = false;
    const h = makeHarness("left", "11111111-1111-4111-8111-111111111111", {
      drawCompletion: () => drawn,
      route: "browser",
      baseline: () => ({ type: "tdMesh", assetId: "left-baseline", sha256: "a".repeat(64) }),
    });
    await h.runtime.start();
    h.state(3); h.frame(); h.render();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    drawn = true;
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({
      type: "otef_projection_applied", route: "browser", revision: 3, success: true,
      baseline: { type: "tdMesh", assetId: "left-baseline", sha256: "a".repeat(64) },
    }));
  });

  test("metadata updates with the same snapshot keep the pending render waiter", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame();
    const waiter = [...h.renderListeners][0];
    h.state(1, structuredClone(DEFAULT_PROJECTION_CONFIG));
    h.frame();
    expect(h.applied).toHaveLength(1);
    expect([...h.renderListeners][0]).toBe(waiter);
    h.render();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied" && message.success)).toHaveLength(1);
  });

  test("does not acknowledge a stale render callback", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(2); h.frame();
    const stale = [...h.renderListeners][0];
    h.state(3); h.frame();
    stale?.();
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 3, success: true }));
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ revision: 2, success: true }));
  });

  test("removes scoped error listener on success, invalidation, failure, and stop", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame();
    expect(h.errorListeners.size).toBe(1);
    h.render();
    expect(h.errorListeners.size).toBe(0);
    h.state(2); h.frame(); h.runtime.invalidate();
    expect(h.errorListeners.size).toBe(0);
    h.runtime.resume(); h.frame(); h.error({ error: new Error("render failed") });
    expect(h.errorListeners.size).toBe(0);
    h.state(3); h.frame(); h.runtime.stop();
    expect(h.errorListeners.size).toBe(0);
  });

  test("requires a render after apply returns even if apply emitted a render", async () => {
    const h = makeHarness("left", "11111111-1111-4111-8111-111111111111", { applyConfig: (_config, _revision, { render }) => render() });
    await h.runtime.start();
    h.state(1); h.frame();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 1, success: true }));
  });

  test("a superseded render error cannot fail the old or new revision", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame();
    const oldError = [...h.errorListeners][0];
    h.state(2);
    oldError({ error: new Error("old render failed") });
    h.frame();
    oldError({ error: new Error("old render failed") });
    h.render();
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ revision: 1, success: false }));
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ revision: 2, success: false }));
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 2, success: true }));
  });

  test("initial partial apply failure restores the default presentation without confirming it", async () => {
    const initial = { ...DEFAULT_PROJECTION_CONFIG, pre: { ...DEFAULT_PROJECTION_CONFIG.pre, tx: 0.05 } };
    let current = initial;
    let calls = 0;
    const h = makeHarness("left", "11111111-1111-4111-8111-111111111111", { applyConfig: (config) => {
      current = config;
      if (++calls === 1) throw new Error("partial first apply");
    }, initialConfig: initial });
    await h.runtime.start();
    h.state(1, DEFAULT_PROJECTION_CONFIG); h.frame();
    expect(current).toEqual(initial);
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 1, success: false }));
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ revision: 1, success: true }));
    h.sent().length = 0;
    h.socketListeners.get("otef_projection_status_request")?.({ table: "otef" });
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 1, success: false }));
  });

  test("restores real span and name-controller guards after partial bridge mutation", async () => {
    const { map, controller, getEffective } = realSpanAndNames();
    let listener;
    const queued = [];
    const sent = [];
    const client = { subscribe(fn) { listener = fn; fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() };
    const socket = { on() {}, off() {}, send: (message) => sent.push(message) };
    let failOnce = true;
    const applyConfig = (config, revision) => {
      if (map.setEffectiveProjectionConfig(config, revision) === false) throw new Error("camera rejected");
      if (revision === 2 && failOnce) { failOnce = false; throw new Error("after camera"); }
      if (!controller.setProjectionConfig(config, revision)) throw new Error("names rejected");
    };
    const runtime = createProjectionConfigRuntime({ map, spanId: "left", client, socket, applyConfig, instanceId: "11111111-1111-4111-8111-111111111111", requestFrame: (fn) => queued.push(fn), cancelFrame() {} });
    await runtime.start();
    listener({ snapshot: { revision: 1, config: DEFAULT_PROJECTION_CONFIG } }); queued.shift()(); map.emit("render");
    const changed = { ...DEFAULT_PROJECTION_CONFIG, pre: { ...DEFAULT_PROJECTION_CONFIG.pre, tx: 0.2 } };
    listener({ snapshot: { revision: 2, config: changed } }); queued.shift()();
    expect(getEffective()).toEqual(DEFAULT_PROJECTION_CONFIG);
    expect(map._otefProjectionSpanEffectiveConfig).toEqual(DEFAULT_PROJECTION_CONFIG);
    expect(map._otefProjectionSpanRevision).toBe(2);
    expect(controller.getProjectionNameDiagnostics().revision).toBe(2);
    expect(sent).toContainEqual(expect.objectContaining({ revision: 2, success: false, error: "after camera" }));
    controller.dispose(); runtime.stop();
  });

  test("holds status requests and new snapshots during resize until reapplication", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame(); h.render();
    h.sent().length = 0;
    h.runtime.invalidate();
    h.runtime.requestStatus();
    h.state(2); h.frame(); h.render();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    h.runtime.resume(); h.frame(); h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 2, success: true }));
  });

  test("restores the last valid config and reports an apply error", async () => {
    let listener;
    const queued = [];
    const sent = [];
    const renderListeners = new Set();
    const client = { subscribe: (fn) => { listener = fn; fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() };
    const socket = { on() {}, off() {}, send: (message) => { sent.push(message); return true; } };
    const map = { on: (name, fn) => { if (name === "render") renderListeners.add(fn); }, off: (name, fn) => { if (name === "render") renderListeners.delete(fn); }, triggerRepaint() {} };
    let calls = 0;
    let bridgeRevision = -1;
    let controllerRevision = -1;
    const configs = [];
    const runtime = createProjectionConfigRuntime({
      map, spanId: "left", client, socket, instanceId: "11111111-1111-4111-8111-111111111111",
      requestFrame: (fn) => { queued.push(fn); }, cancelFrame() {},
      applyConfig: (config, revision) => { calls += 1; if (revision < bridgeRevision || revision < controllerRevision) throw new Error("stale revision"); bridgeRevision = revision; controllerRevision = revision; configs.push({ config, revision }); if (revision === 2 && calls === 2) throw new Error("camera failed"); },
    });
    await runtime.start();
    listener({ snapshot: { revision: 1, config: DEFAULT_PROJECTION_CONFIG } }); queued.shift()();
    [...renderListeners].forEach((fn) => fn());
    listener({ snapshot: { revision: 2, config: DEFAULT_PROJECTION_CONFIG } }); queued.shift()();
    expect(calls).toBe(3);
    expect(configs.map((item) => item.revision)).toEqual([1, 2, 2]);
    expect(sent).toContainEqual(expect.objectContaining({ revision: 2, success: false, error: "camera failed" }));
  });

  test("does not acknowledge synchronously rendered apply that later throws", async () => {
    const h = makeHarness();
    h.runtime.stop();
    let listener;
    const queued = [];
    const socket = { on() {}, off() {}, send: (message) => h.sent().push(message) };
    const client = { subscribe: (fn) => { listener = fn; fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() };
    const map = { on: (name, fn) => { if (name === "render") h.renderListeners.add(fn); }, off: (name, fn) => { if (name === "render") h.renderListeners.delete(fn); }, triggerRepaint() {} };
    const runtime = createProjectionConfigRuntime({ map, spanId: "left", client, socket, instanceId: "11111111-1111-4111-8111-111111111111", requestFrame: (fn) => { queued.push(fn); }, cancelFrame() {}, applyConfig: () => { h.render(); throw new Error("late apply failure"); } });
    await runtime.start();
    listener({ snapshot: { revision: 4, config: DEFAULT_PROJECTION_CONFIG } });
    queued.shift()();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied").map((message) => message.success)).toEqual([false]);
  });

  test("rolls back an asynchronous render error to the last completed config", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame(); h.render();
    const next = { ...DEFAULT_PROJECTION_CONFIG, pre: { ...DEFAULT_PROJECTION_CONFIG.pre, tx: 0.2 } };
    h.state(2, next); h.frame(); h.error({ error: new Error("render failed") });
    expect(h.applied.at(-1).revision).toBe(2);
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 2, success: false, error: "render failed" }));
  });

  test("does not claim rollback restoration when its draw does not complete", async () => {
    let drawCount = 0;
    const h = makeHarness("left", "11111111-1111-4111-8111-111111111111", {
      drawCompletion: () => ++drawCount === 1,
    });
    const rollback = vi.fn();
    h.map._otefNliNameFieldController = { _rollbackProjectionConfig: rollback };
    await h.runtime.start();
    h.state(1); h.frame(); h.render();
    const next = { ...DEFAULT_PROJECTION_CONFIG, pre: { ...DEFAULT_PROJECTION_CONFIG.pre, tx: 0.2 } };
    h.state(2, next); h.frame(); h.error({ error: new Error("render failed") });
    expect(rollback).toHaveBeenCalledWith(DEFAULT_PROJECTION_CONFIG, 2);
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 2, success: false, error: "render failed" }));
  });

  test("restores the name field through its internal rollback path at the failed revision", async () => {
    const h = makeHarness("left", "11111111-1111-4111-8111-111111111111", {
      applyConfig: (_config, revision) => { if (revision === 2) throw new Error("name controller rejected rollback"); },
    });
    const rollback = vi.fn();
    h.map._otefNliNameFieldController = { _rollbackProjectionConfig: rollback };
    await h.runtime.start();
    h.state(1); h.frame(); h.render();
    const next = { ...DEFAULT_PROJECTION_CONFIG, pre: { ...DEFAULT_PROJECTION_CONFIG.pre, tx: 0.2 } };
    h.state(2, next); h.frame(); h.error({ error: new Error("render failed") });
    expect(rollback).toHaveBeenCalledWith(DEFAULT_PROJECTION_CONFIG, 2);
  });

  test("rolls every projection consumer back through the production apply ordering", async () => {
    const map = createFakeMapLibreMap();
    const container = { dataset: {} };
    map.getContainer = () => container;
    map.getZoom = () => 10;
    map.getBearing = () => 0;
    map.getPitch = () => 0;
    map.getCenter = () => ({ lng: 34.5, lat: 31.4 });
    const context = { subscribe: () => () => {}, getPersonSelection: () => ({ personId: null, datasetVersion: null, revision: 0 }) };
    const controller = createNliNameFieldController({ map, context, projectionSpan: "left" });
    let cameraConfig = null;
    let cameraRevision = -1;
    map.setEffectiveProjectionConfig = (config, revision) => {
      if (revision < cameraRevision) return false;
      cameraConfig = structuredClone(config);
      cameraRevision = revision;
      return true;
    };
    const pattern = { config: null, setConfig(config) { this.config = structuredClone(config); } };
    const syncContextInvestigation = vi.fn();
    const applyConfig = (config, revision) => {
      if (map.setEffectiveProjectionConfig(config, revision) === false) throw new Error("projection camera rejected calibration");
      if (!controller.setProjectionConfig(config, revision)) throw new Error("projection names rejected calibration");
      pattern.setConfig(config);
      syncContextInvestigation();
    };
    let listener;
    const queued = [];
    const runtime = createProjectionConfigRuntime({
      map,
      spanId: "left",
      client: { subscribe(fn) { listener = fn; fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() },
      socket: { on() {}, off() {}, send() {} },
      instanceId: "11111111-1111-4111-8111-111111111111",
      requestFrame: (fn) => { queued.push(fn); },
      cancelFrame() {},
      applyConfig,
    });
    await runtime.start();
    listener({ snapshot: { revision: 1, config: DEFAULT_PROJECTION_CONFIG } });
    queued.shift()();
    [...map._listeners.get("render")].forEach((fn) => fn());
    const lastGood = structuredClone(DEFAULT_PROJECTION_CONFIG);
    const changed = structuredClone(DEFAULT_PROJECTION_CONFIG);
    changed.pre.tx = 0.2;
    listener({ snapshot: { revision: 2, config: changed } });
    queued.shift()();
    [...map._listeners.get("error")].forEach((fn) => fn({ error: new Error("render failed") }));
    expect(cameraConfig).toEqual(lastGood);
    expect(controller.getProjectionNameDiagnostics().revision).toBe(2);
    expect(controller.setProjectionConfig(lastGood, 2)).toBe(true);
    expect(controller.setProjectionConfig(changed, 2)).toBe(false);
    expect(pattern.config).toEqual(lastGood);
    expect(syncContextInvestigation).toHaveBeenCalledTimes(3);
    controller.dispose();
    runtime.stop();
  });

  test("full reference ignores calibration and patterns", async () => {
    const h = makeHarness(null);
    await h.runtime.start();
    h.state(4); h.frame(); h.render();
    expect(h.applied).toEqual([]);
    h.socketListeners.get("otef_projection_pattern")?.({ type: "otef_projection_pattern", output: "left", pattern: "grid", table: "otef" });
    expect(h.sent()).toEqual([]);
  });

  test("status request asks for a completed-render response", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame(); h.render();
    h.sent().length = 0;
    h.runtime.requestStatus();
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: "otef_projection_status_request", sourceId: expect.any(String) }));
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: "otef_projection_applied", revision: 1, success: true }));
  });

  test("same-span instances retain distinct status identities", async () => {
    const a = makeHarness("left", "11111111-1111-4111-8111-111111111111");
    const b = makeHarness("left", "22222222-2222-4222-8222-222222222222");
    await a.runtime.start(); await b.runtime.start();
    a.runtime.requestStatus(); b.runtime.requestStatus();
    a.state(1); b.state(1); a.frame(); b.frame(); a.render(); b.render();
    const aApplied = a.sent().find((message) => message.type === "otef_projection_applied");
    const bApplied = b.sent().find((message) => message.type === "otef_projection_applied");
    expect(aApplied.instanceId).not.toBe(bApplied.instanceId);
  });

  test("resize invalidation rejects an interim render callback", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame();
    const oldRender = [...h.renderListeners][0];
    h.runtime.invalidate();
    oldRender();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
  });

  test("bounded render timeout reports failure when no frame completes", async () => {
    const h = makeHarness();
    const timers = [];
    const runtime = createProjectionConfigRuntime({
      map: h.map, spanId: "left", client: { subscribe: (fn) => { h.state = (revision) => fn({ snapshot: { revision, config: DEFAULT_PROJECTION_CONFIG } }); fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() },
      socket: { on() {}, off() {}, send: (message) => h.sent().push(message) }, instanceId: "11111111-1111-4111-8111-111111111111",
      requestFrame: (fn) => { h._frame = fn; }, cancelFrame() {}, clock: { setTimeout: (fn) => { timers.push(fn); return fn; }, clearTimeout() {} }, renderTimeoutMs: 25,
      applyConfig() {},
    });
    await runtime.start();
    h.state(5); h._frame();
    timers.at(-1)();
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 5, success: false, error: "render completion timeout" }));
  });

  test("hidden output defers render timeout until it can render", async () => {
    const h = makeHarness();
    const timers = [];
    let visible = false;
    let state;
    let frame;
    const runtime = createProjectionConfigRuntime({
      map: h.map, spanId: "left", client: { subscribe: (fn) => { state = fn; fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() },
      socket: { on() {}, off() {}, send: (message) => h.sent().push(message) }, instanceId: "11111111-1111-4111-8111-111111111111",
      requestFrame: (fn) => { frame = fn; }, cancelFrame() {}, clock: { setTimeout: (fn) => { timers.push(fn); return fn; }, clearTimeout() {} }, renderTimeoutMs: 25,
      isDocumentVisible: () => visible, applyConfig() {},
    });
    await runtime.start();
    state({ snapshot: { revision: 5, config: DEFAULT_PROJECTION_CONFIG } }); frame();
    timers.shift()();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    visible = true;
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 5, success: true }));
    runtime.stop();
  });
});
