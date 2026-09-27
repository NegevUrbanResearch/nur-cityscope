import { idleNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";

let setLayerAnimations;
let toggleAnimation;
let zoom;
let pan;
let setBasemap;
let updateViewportFromUI;
let computePanViewport;
let computeZoomViewport;
let setEnabledLayerIds;

beforeEach(async () => {
  vi.resetModules();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  });

  const mod = await import('../../frontend/src/shared/otef-data-context/OTEFDataContext-actions.js');
  setLayerAnimations = mod.setLayerAnimations;
  toggleAnimation = mod.toggleAnimation;
  zoom = mod.zoom;
  pan = mod.pan;
  setBasemap = mod.setBasemap;
  updateViewportFromUI = mod.updateViewportFromUI;
  computePanViewport = mod.computePanViewport;
  computeZoomViewport = mod.computeZoomViewport;
  setEnabledLayerIds = mod.setEnabledLayerIds;
});

afterEach(() => {
  delete global.fetch;
});

function makeMockContextWithAnimations(initial) {
  return {
    _tableName: 'otef',
    _animations: initial,
    _setAnimations(next) {
      this._animations = next;
    },
  };
}

describe('OTEFDataContext actions', () => {
  test('setLayerAnimations toggles multiple layer ids in one state update', async () => {
    const ctx = makeMockContextWithAnimations({});
    const ids = ['october_7th.?????_?????-???', 'october_7th.????_??????_???'];

    const result = await setLayerAnimations(ctx, ids, true);

    expect(result.ok).toBe(true);
    expect(ctx._animations[ids[0]]).toBe(true);
    expect(ctx._animations[ids[1]]).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });

  test('toggleAnimation("nli.lines", true) does not change the clock', async () => {
    const clock = idleNliClock();
    const ctx = makeMockContextWithAnimations({});
    ctx._investigationClock = { ...clock };
    ctx._pendingAnimationOps = 0;
    ctx._setInvestigationClock = function setClock(next) {
      this._investigationClock = next;
    };

    const result = await toggleAnimation(ctx, "nli.lines", true);

    expect(result.ok).toBe(true);
    expect(ctx._investigationClock).toEqual(clock);
    expect(ctx._animations["nli.lines"]).toBeFalsy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("setLayerAnimations no-ops NLI playable ids without touching the clock", async () => {
    const clock = idleNliClock();
    const ctx = makeMockContextWithAnimations({});
    ctx._investigationClock = { ...clock };
    ctx._pendingAnimationOps = 0;
    ctx._setInvestigationClock = function setClock(next) {
      this._investigationClock = next;
    };

    const result = await setLayerAnimations(
      ctx,
      ["nli.investigation_polygons", "nli.lines", "nli.alarms"],
      true,
    );

    expect(result.ok).toBe(true);
    expect(ctx._investigationClock).toEqual(clock);
    expect(ctx._animations["nli.investigation_polygons"]).toBeFalsy();
    expect(ctx._animations["nli.lines"]).toBeFalsy();
    expect(ctx._animations["nli.alarms"]).toBeFalsy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("setLayerAnimations still applies non-NLI ids when mixed with playables", async () => {
    const ctx = makeMockContextWithAnimations({});
    ctx._pendingAnimationOps = 0;

    const result = await setLayerAnimations(ctx, ["nli.lines", "october_7th.route_line_test"], true);

    expect(result.ok).toBe(true);
    expect(ctx._animations["nli.lines"]).toBeFalsy();
    expect(ctx._animations["october_7th.route_line_test"]).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });

  test('zoom command includes base_viewport to avoid snapback', async () => {
    const viewport = {
      zoom: 13,
      bbox: [100, 100, 200, 200],
      corners: {
        sw: { x: 100, y: 100 },
        se: { x: 200, y: 100 },
        nw: { x: 100, y: 200 },
        ne: { x: 200, y: 200 },
      },
    };
    const ctx = {
      _tableName: 'otef',
      _isConnected: true,
      _clientId: 'test-client',
      _viewport: viewport,
      _lastLocalStateTimestamp: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds() {
        return true;
      },
      _setViewport: vi.fn(),
    };

    await zoom(ctx, 14);

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestBody.action).toBe('zoom');
    expect(requestBody.base_viewport).toEqual(viewport);
  });

  test('zoom command payload uses base_viewport object reference from before optimistic apply', async () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify');
    const viewport = {
      zoom: 13,
      bbox: [100, 100, 200, 200],
      corners: {
        sw: { x: 100, y: 100 },
        se: { x: 200, y: 100 },
        nw: { x: 100, y: 200 },
        ne: { x: 200, y: 200 },
      },
    };
    const ctx = {
      _tableName: 'otef',
      _isConnected: true,
      _clientId: 'test-client',
      _viewport: viewport,
      _lastLocalStateTimestamp: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds() {
        return true;
      },
      _setViewport: vi.fn(),
    };

    await zoom(ctx, 14);

    const zoomArg = stringifySpy.mock.calls.find(
      (c) => c[0] && typeof c[0] === 'object' && c[0].action === 'zoom',
    );
    expect(zoomArg).toBeTruthy();
    expect(zoomArg[0].base_viewport).toBe(viewport);
    stringifySpy.mockRestore();
  });

  test('pan command includes base_viewport to avoid snapback', async () => {
    const viewport = {
      zoom: 13,
      bbox: [100, 100, 200, 200],
      corners: {
        sw: { x: 100, y: 100 },
        se: { x: 200, y: 100 },
        nw: { x: 100, y: 200 },
        ne: { x: 200, y: 200 },
      },
    };
    const ctx = {
      _tableName: 'otef',
      _isConnected: true,
      _clientId: 'test-client',
      _viewport: viewport,
      _lastLocalStateTimestamp: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds() {
        return true;
      },
      _setViewport: vi.fn(),
    };

    await pan(ctx, 'north', 0.15);

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestBody.action).toBe('pan');
    expect(requestBody.base_viewport).toEqual(viewport);
  });

  test('pan command payload uses base_viewport object reference from before optimistic apply', async () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify');
    const viewport = {
      zoom: 13,
      bbox: [100, 100, 200, 200],
      corners: {
        sw: { x: 100, y: 100 },
        se: { x: 200, y: 100 },
        nw: { x: 100, y: 200 },
        ne: { x: 200, y: 200 },
      },
    };
    const ctx = {
      _tableName: 'otef',
      _isConnected: true,
      _clientId: 'test-client',
      _viewport: viewport,
      _lastLocalStateTimestamp: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds() {
        return true;
      },
      _setViewport: vi.fn(),
    };

    await pan(ctx, 'north', 0.15);

    const panArg = stringifySpy.mock.calls.find(
      (c) => c[0] && typeof c[0] === 'object' && c[0].action === 'pan',
    );
    expect(panArg).toBeTruthy();
    expect(panArg[0].base_viewport).toBe(viewport);
    stringifySpy.mockRestore();
  });

  test('pan applies optimistic _setViewport before delayed executeCommand resolves', async () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(42_000);
    const serverViewport = {
      zoom: 14,
      bbox: [5, 6, 7, 8],
      corners: {
        sw: { x: 5, y: 6 },
        se: { x: 7, y: 6 },
        nw: { x: 5, y: 8 },
        ne: { x: 7, y: 8 },
      },
    };

    let resolveCommand;
    const commandGate = new Promise((r) => {
      resolveCommand = r;
    });

    global.fetch = vi.fn(() =>
      commandGate.then(() => ({
        ok: true,
        json: async () => ({
          status: 'ok',
          action: 'pan',
          viewport: serverViewport,
        }),
      })),
    );

    const setViewport = vi.fn();
    const viewport = {
      zoom: 14,
      bbox: [10, 10, 20, 20],
      corners: {
        sw: { x: 10, y: 10 },
        se: { x: 20, y: 10 },
        nw: { x: 10, y: 20 },
        ne: { x: 20, y: 20 },
      },
    };
    const optimisticCandidate = computePanViewport(viewport, 'north', 0.15);
    const ctx = {
      _tableName: 'otef',
      _isConnected: true,
      _clientId: 'test-client',
      _viewport: viewport,
      _lastLocalStateTimestamp: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds() {
        return true;
      },
      _setViewport: setViewport,
    };

    const panPromise = pan(ctx, 'north', 0.15);
    await Promise.resolve();

    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        bbox: optimisticCandidate.bbox,
        corners: optimisticCandidate.corners,
        zoom: optimisticCandidate.zoom,
        sourceId: 'test-client',
        timestamp: 42_000,
      }),
    );

    resolveCommand();
    await panPromise;

    expect(setViewport.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(setViewport.mock.calls[setViewport.mock.calls.length - 1][0]).toEqual(
      expect.objectContaining({
        bbox: [5, 6, 7, 8],
        sourceId: 'test-client',
        timestamp: 42_000,
      }),
    );

    const panArg = stringifySpy.mock.calls.find(
      (c) => c[0] && typeof c[0] === 'object' && c[0].action === 'pan',
    );
    expect(panArg).toBeTruthy();
    expect(panArg[0].base_viewport).toBe(viewport);

    nowSpy.mockRestore();
    stringifySpy.mockRestore();
  });

  test('computePanViewport translates skewed viewport corners', () => {
    const viewport = {
      bbox: [100, 100, 700, 700],
      zoom: 14,
      corners: {
        sw: { x: 120, y: 120 },
        se: { x: 640, y: 90 },
        nw: { x: 140, y: 720 },
        ne: { x: 710, y: 690 },
      },
    };

    const result = computePanViewport(viewport, 'east', 0.1);

    expect(result.bbox).toEqual([160, 100, 760, 700]);
    expect(result.corners).toEqual({
      sw: { x: 180, y: 120 },
      se: { x: 700, y: 90 },
      nw: { x: 200, y: 720 },
      ne: { x: 770, y: 690 },
    });
  });

  test('zoom applies viewport from executeCommand JSON on success', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(42_000);
    const serverViewport = {
      zoom: 14,
      bbox: [1, 2, 3, 4],
      corners: {
        sw: { x: 1, y: 2 },
        se: { x: 3, y: 2 },
        nw: { x: 1, y: 4 },
        ne: { x: 3, y: 4 },
      },
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        action: 'zoom',
        viewport: serverViewport,
      }),
    });

    const setViewport = vi.fn();
    const viewport = {
      zoom: 13,
      bbox: [10, 10, 20, 20],
      corners: {
        sw: { x: 10, y: 10 },
        se: { x: 20, y: 10 },
        nw: { x: 10, y: 20 },
        ne: { x: 20, y: 20 },
      },
    };
    const ctx = {
      _tableName: 'otef',
      _isConnected: true,
      _clientId: 'test-client',
      _viewport: viewport,
      _lastLocalStateTimestamp: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds() {
        return true;
      },
      _setViewport: setViewport,
    };

    await zoom(ctx, 14);

    expect(setViewport).toHaveBeenCalled();
    expect(setViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        zoom: 14,
        bbox: [1, 2, 3, 4],
        sourceId: 'test-client',
        timestamp: 42_000,
      }),
    );
    nowSpy.mockRestore();
  });

  test('zoom applies optimistic _setViewport before delayed executeCommand resolves', async () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(42_000);
    const serverViewport = {
      zoom: 14,
      bbox: [1, 2, 3, 4],
      corners: {
        sw: { x: 1, y: 2 },
        se: { x: 3, y: 2 },
        nw: { x: 1, y: 4 },
        ne: { x: 3, y: 4 },
      },
    };

    let resolveCommand;
    const commandGate = new Promise((r) => {
      resolveCommand = r;
    });

    global.fetch = vi.fn(() =>
      commandGate.then(() => ({
        ok: true,
        json: async () => ({
          status: 'ok',
          action: 'zoom',
          viewport: serverViewport,
        }),
      })),
    );

    const setViewport = vi.fn();
    const viewport = {
      zoom: 13,
      bbox: [10, 10, 20, 20],
      corners: {
        sw: { x: 10, y: 10 },
        se: { x: 20, y: 10 },
        nw: { x: 10, y: 20 },
        ne: { x: 20, y: 20 },
      },
    };
    const ctx = {
      _tableName: 'otef',
      _isConnected: true,
      _clientId: 'test-client',
      _viewport: viewport,
      _lastLocalStateTimestamp: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds() {
        return true;
      },
      _setViewport: setViewport,
    };

    const zoomPromise = zoom(ctx, 14);
    await Promise.resolve();

    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        zoom: 14,
        sourceId: 'test-client',
        timestamp: 42_000,
      }),
    );

    resolveCommand();
    await zoomPromise;

    expect(setViewport.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(setViewport.mock.calls[setViewport.mock.calls.length - 1][0]).toEqual(
      expect.objectContaining({
        zoom: 14,
        bbox: [1, 2, 3, 4],
        sourceId: 'test-client',
        timestamp: 42_000,
      }),
    );

    const zoomArg = stringifySpy.mock.calls.find(
      (c) => c[0] && typeof c[0] === 'object' && c[0].action === 'zoom',
    );
    expect(zoomArg).toBeTruthy();
    expect(zoomArg[0].base_viewport).toBe(viewport);

    nowSpy.mockRestore();
    stringifySpy.mockRestore();
  });

  test('computeZoomViewport scales skewed viewport corners around bbox center', () => {
    const viewport = {
      bbox: [100, 100, 700, 700],
      zoom: 14,
      corners: {
        sw: { x: 120, y: 120 },
        se: { x: 640, y: 90 },
        nw: { x: 140, y: 720 },
        ne: { x: 710, y: 690 },
      },
    };

    const result = computeZoomViewport(viewport, 15);

    expect(result.bbox).toEqual([250, 250, 550, 550]);
    expect(result.corners).toEqual({
      sw: { x: 260, y: 260 },
      se: { x: 520, y: 245 },
      nw: { x: 270, y: 560 },
      ne: { x: 555, y: 545 },
    });
  });

  test('pan applies viewport from executeCommand JSON on success', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(99_000);
    const serverViewport = {
      zoom: 14,
      bbox: [5, 6, 7, 8],
      corners: {
        sw: { x: 5, y: 6 },
        se: { x: 7, y: 6 },
        nw: { x: 5, y: 8 },
        ne: { x: 7, y: 8 },
      },
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        action: 'pan',
        viewport: serverViewport,
      }),
    });

    const setViewport = vi.fn();
    const baseViewport = {
      zoom: 14,
      bbox: [1, 2, 3, 4],
      corners: {
        sw: { x: 1, y: 2 },
        se: { x: 3, y: 2 },
        nw: { x: 1, y: 4 },
        ne: { x: 3, y: 4 },
      },
    };
    const ctx = {
      _tableName: 'otef',
      _isConnected: true,
      _clientId: 'test-client-2',
      _viewport: baseViewport,
      _lastLocalStateTimestamp: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds() {
        return true;
      },
      _setViewport: setViewport,
    };

    await pan(ctx, 'north', 0.15);

    expect(setViewport).toHaveBeenCalled();
    expect(setViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        bbox: [5, 6, 7, 8],
        sourceId: 'test-client-2',
        timestamp: 99_000,
      }),
    );
    nowSpy.mockRestore();
  });

  test('updateViewportFromUI allows GIS handoff when velocity loop is stale/stopped', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const setViewport = vi.fn((next) => next);
    const ctx = {
      _tableName: 'otef',
      _clientId: 'test-client',
      _velocityLoopActive: true,
      _velocity: { vx: 0, vy: 0 },
      _lastVelocityUpdate: 9_000,
      _currentInteractionSource: null,
      _isViewportInsideBounds: () => true,
      _setViewport: setViewport,
      _viewport: null,
      _lastLocalStateTimestamp: 0,
    };
    const viewport = {
      bbox: [100, 100, 200, 200],
      zoom: 14,
      corners: {
        sw: { x: 100, y: 100 },
        se: { x: 200, y: 100 },
        nw: { x: 100, y: 200 },
        ne: { x: 200, y: 200 },
      },
    };

    const result = updateViewportFromUI(ctx, viewport, 'gis');

    expect(result).toEqual({ accepted: true });
    expect(setViewport).toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  test('updateViewportFromUI keeps ordinary GIS viewport patches debounced', () => {
    vi.useFakeTimers();
    const setViewport = vi.fn((next) => next);
    const ctx = {
      _tableName: 'otef',
      _clientId: 'test-client',
      _velocity: { vx: 0, vy: 0 },
      _lastVelocityUpdate: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds: () => true,
      _setViewport: setViewport,
      _viewport: null,
      _lastLocalStateTimestamp: 0,
    };
    const viewport = {
      bbox: [100, 100, 200, 200],
      zoom: 14,
      corners: {
        sw: { x: 100, y: 100 },
        se: { x: 200, y: 100 },
        nw: { x: 100, y: 200 },
        ne: { x: 200, y: 200 },
      },
    };

    const result = updateViewportFromUI(ctx, viewport, 'gis');

    expect(result).toEqual({ accepted: true });
    expect(global.fetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(119);
    expect(global.fetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test('updateViewportFromUI can publish navigation GIS snapshots immediately', () => {
    const setViewport = vi.fn((next) => next);
    const ctx = {
      _tableName: 'otef',
      _clientId: 'test-client',
      _velocity: { vx: 0, vy: 0 },
      _lastVelocityUpdate: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds: () => true,
      _setViewport: setViewport,
      _viewport: null,
      _lastLocalStateTimestamp: 0,
    };
    const viewport = {
      bbox: [100, 100, 200, 200],
      zoom: 14,
      corners: {
        sw: { x: 100, y: 100 },
        se: { x: 200, y: 100 },
        nw: { x: 100, y: 200 },
        ne: { x: 200, y: 200 },
      },
    };

    const result = updateViewportFromUI(ctx, viewport, 'gis', {
      sharedUpdate: 'immediate',
      traceId: 'place-nav-test',
    });

    expect(result).toEqual({ accepted: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestBody.viewport.bbox).toEqual([100, 100, 200, 200]);
    expect(requestBody.sourceId).toBe('test-client');
    expect(requestBody.traceId).toBe('place-nav-test');
  });

  test('updateViewportFromUI relays transient navigation snapshots without an HTTP write', () => {
    const send = vi.fn(() => true);
    const ctx = {
      _tableName: 'otef',
      _clientId: 'test-client',
      _velocity: { vx: 0, vy: 0 },
      _lastVelocityUpdate: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds: () => true,
      _setViewport: vi.fn((next) => next),
      _viewport: null,
      _lastLocalStateTimestamp: 0,
      _wsClient: { getConnected: () => true, send },
    };
    const viewport = {
      bbox: [100, 100, 200, 200],
      zoom: 14,
      corners: {
        sw: { x: 100, y: 100 }, se: { x: 200, y: 100 },
        nw: { x: 100, y: 200 }, ne: { x: 200, y: 200 },
      },
    };

    const result = updateViewportFromUI(ctx, viewport, 'gis', {
      sharedUpdate: 'transient',
      traceId: 'place-nav-transient',
    });

    expect(result).toEqual({ accepted: true });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'otef_viewport_update',
      table: 'otef',
      viewport: expect.objectContaining({ bbox: viewport.bbox }),
      sourceId: 'test-client',
      traceId: 'place-nav-transient',
      transient: true,
    }));
  });

  test('updateViewportFromUI preserves navigation metadata when viewport is unchanged', () => {
    const existingViewport = {
      bbox: [100, 100, 200, 200],
      zoom: 14,
      corners: {
        sw: { x: 100, y: 100 },
        se: { x: 200, y: 100 },
        nw: { x: 100, y: 200 },
        ne: { x: 200, y: 200 },
      },
      sourceId: 'old-client',
      timestamp: 1,
      seq: 7,
    };
    const setViewport = vi.fn(() => undefined);
    const ctx = {
      _tableName: 'otef',
      _clientId: 'test-client',
      _velocity: { vx: 0, vy: 0 },
      _lastVelocityUpdate: 0,
      _currentInteractionSource: null,
      _isViewportInsideBounds: () => true,
      _setViewport: setViewport,
      _viewport: existingViewport,
      _lastLocalStateTimestamp: 0,
    };

    const result = updateViewportFromUI(ctx, existingViewport, 'gis', {
      sharedUpdate: 'immediate',
      traceId: 'place-nav-equal',
    });

    expect(result).toEqual({ accepted: true });
    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestBody.viewport.bbox).toEqual(existingViewport.bbox);
    expect(requestBody.sourceId).toBe('test-client');
    expect(requestBody.viewport.sourceId).toBe('test-client');
    expect(requestBody.traceId).toBe('place-nav-equal');
    expect(requestBody.viewport.traceId).toBe('place-nav-equal');
  });

  test('setBasemap patches supported basemap state', async () => {
    const ctx = {
      _tableName: 'otef',
      _clientId: 'test-client',
      _basemap: 'osm',
      _setBasemap: vi.fn(function setBasemapState(next) {
        this._basemap = next;
      }),
      _setConfirmedBasemap: vi.fn(function setConfirmedBasemapState(next) {
        this._setBasemap(next);
      }),
    };

    const result = await setBasemap(ctx, 'satellite');

    expect(result).toEqual({ ok: true });
    expect(ctx._setBasemap).toHaveBeenCalledWith('satellite');
    expect(ctx._setConfirmedBasemap).toHaveBeenCalledWith('satellite');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(global.fetch.mock.calls[0][0]).toContain('/otef/');
    expect(global.fetch.mock.calls[0][1].method).toBe('PATCH');
    expect(body.basemap).toBe('satellite');
    expect(body.sourceId).toBe('test-client');
  });

  test('setBasemap patches dark basemap state', async () => {
    const ctx = {
      _tableName: 'otef',
      _clientId: 'test-client',
      _basemap: 'osm',
      _setBasemap: vi.fn(function setBasemapState(next) {
        this._basemap = next;
      }),
      _setConfirmedBasemap: vi.fn(function setConfirmedBasemapState(next) {
        this._setBasemap(next);
      }),
    };

    const result = await setBasemap(ctx, 'dark');

    expect(result).toEqual({ ok: true });
    expect(ctx._setBasemap).toHaveBeenCalledWith('dark');
    expect(ctx._setConfirmedBasemap).toHaveBeenCalledWith('dark');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.basemap).toBe('dark');
  });

});

function splitFullLayerId(fullId) {
  const dot = fullId.indexOf(".");
  return [fullId.slice(0, dot), fullId.slice(dot + 1)];
}

function layerRow(groups, fullId) {
  const [groupId, layerId] = splitFullLayerId(fullId);
  const group = (groups || []).find((item) => item && item.id === groupId);
  return group?.layers?.find((layer) => layer && String(layer.id) === layerId);
}

function isFullLayerEnabled(groups, fullId) {
  return !!layerRow(groups, fullId)?.enabled;
}

function makeExclusiveLayerContext(layerGroups, extras = {}) {
  const snapshots = [];
  const ctx = {
    _tableName: "otef",
    _clientId: "test-client",
    _pendingLayerOps: 0,
    _pendingAnimationOps: 0,
    _layerOpGeneration: 0,
    _layerGroups: layerGroups,
    _animations: {},
    _setActiveLayerTrace: vi.fn(),
    _clearActiveLayerTrace: vi.fn(),
    _setAnimations(next) {
      this._animations = next;
    },
    ...extras,
  };
  ctx._setLayerGroups = (next) => {
    if (!Array.isArray(next)) return;
    snapshots.push(JSON.parse(JSON.stringify(next)));
    ctx._layerGroups = next;
  };
  ctx.snapshots = snapshots;
  return ctx;
}

function fetchBodies() {
  return global.fetch.mock.calls.map((call) => {
    const init = call[1] || {};
    return {
      url: String(call[0]),
      body: init.body ? JSON.parse(init.body) : null,
    };
  });
}

function toggleCommands() {
  return fetchBodies().filter((call) => call.body && call.body.action === "set_layer_toggles");
}

function jsonResult(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  };
}

describe("setEnabledLayerIds", () => {
  const sharedId = "nli.shared";
  const oldId = "nli.old_story";
  const newId = "nli.new_story";

  function storyGroups() {
    return [
      {
        id: "nli",
        enabled: true,
        layers: [
          { id: "shared", displayName: "Shared", enabled: true },
          { id: "old_story", displayName: "Old story", enabled: true },
          { id: "new_story", displayName: "New story", enabled: false },
        ],
      },
    ];
  }

  test("rejects missing context and non-array ids", async () => {
    const missingTable = await setEnabledLayerIds({ _tableName: "" }, []);
    const missingContext = await setEnabledLayerIds(null, ["nli.shared"]);
    const invalidIds = await setEnabledLayerIds(
      { _tableName: "otef", _layerGroups: storyGroups() },
      "nli.shared",
    );

    expect(missingTable).toMatchObject({ ok: false });
    expect(missingTable.error).toBeTruthy();
    expect(missingContext).toMatchObject({ ok: false });
    expect(missingContext.error).toBeTruthy();
    expect(invalidIds).toMatchObject({ ok: false });
    expect(invalidIds.error).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("keeps a shared row enabled while old and new rows change in one snapshot", async () => {
    const ctx = makeExclusiveLayerContext(storyGroups());
    global.fetch = vi.fn(async () => jsonResult({
      ok: true,
      layerGroups: JSON.parse(JSON.stringify(ctx._layerGroups)),
    }));

    const result = await setEnabledLayerIds(ctx, [sharedId, newId], { traceId: "exclusive-shared" });

    expect(result).toEqual({ ok: true });
    expect(ctx.snapshots.length).toBeGreaterThan(0);
    for (const snapshot of ctx.snapshots) {
      expect(isFullLayerEnabled(snapshot, sharedId)).toBe(true);
      expect(isFullLayerEnabled(snapshot, oldId)).toBe(false);
      expect(isFullLayerEnabled(snapshot, newId)).toBe(true);
    }
    expect(isFullLayerEnabled(ctx._layerPatchLastAcked, sharedId)).toBe(true);
    expect(isFullLayerEnabled(ctx._layerGroups, oldId)).toBe(false);
    expect(isFullLayerEnabled(ctx._layerGroups, newId)).toBe(true);
    expect(layerRow(ctx._layerGroups, sharedId).displayName).toBe("Shared");

    const commands = toggleCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].body.changes).toEqual([
      { full_layer_id: oldId, enabled: false },
      { full_layer_id: newId, enabled: true },
    ]);
    expect(commands[0].body.changes.some((change) => change.full_layer_id === sharedId)).toBe(false);
    expect(fetchBodies().some((call) => call.body && call.body.action === "set_layers_enabled")).toBe(false);
    expect(ctx._setActiveLayerTrace).toHaveBeenCalledWith(expect.objectContaining({
      traceId: "exclusive-shared",
      source: "setEnabledLayerIds",
      fullLayerIds: [sharedId, newId],
    }));
    expect(ctx._pendingLayerOps).toBe(0);
  });

  test("disables every known row when the desired set is empty", async () => {
    const ctx = makeExclusiveLayerContext([
      {
        id: "nli",
        enabled: true,
        layers: [
          { id: "shared", displayName: "Shared", enabled: true },
          { id: "old_story", displayName: "Old story", enabled: true },
        ],
      },
    ]);

    const result = await setEnabledLayerIds(ctx, []);

    expect(result).toEqual({ ok: true });
    expect(isFullLayerEnabled(ctx._layerGroups, sharedId)).toBe(false);
    expect(isFullLayerEnabled(ctx._layerGroups, oldId)).toBe(false);
    expect(layerRow(ctx._layerGroups, sharedId).displayName).toBe("Shared");
    const commands = toggleCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].body.changes).toEqual([
      { full_layer_id: sharedId, enabled: false },
      { full_layer_id: oldId, enabled: false },
    ]);
    expect(ctx._pendingLayerOps).toBe(0);
  });

  test("preserves raw row metadata and turns parking off when no content stays on", async () => {
    const contentId = "curated_moresht_axis.101";
    const parkingId = "curated_moresht_axis.pink_line_parking";
    const ctx = makeExclusiveLayerContext([
      {
        id: "curated_moresht_axis",
        enabled: true,
        label: "Axis pack",
        layers: [
          { id: "101", displayName: "Demo", enabled: true, sourceKey: "workshop-101" },
          { id: "pink_line_parking", displayName: "Parking lots", enabled: true, note: "keep-me" },
        ],
      },
    ]);
    ctx._animations = {
      [contentId]: true,
      [parkingId]: true,
    };

    const result = await setEnabledLayerIds(ctx, [parkingId]);

    expect(result).toEqual({ ok: true });
    const axis = ctx._layerGroups.find((group) => group.id === "curated_moresht_axis");
    expect(axis.label).toBe("Axis pack");
    const content = layerRow(ctx._layerGroups, contentId);
    const parking = layerRow(ctx._layerGroups, parkingId);
    const route = axis.layers.find((layer) => layer.id === "pink_line_route");
    expect(content.enabled).toBe(false);
    expect(content.displayName).toBe("Demo");
    expect(content.sourceKey).toBe("workshop-101");
    expect(parking.enabled).toBe(false);
    expect(parking.displayName).toBe("Parking lots");
    expect(parking.note).toBe("keep-me");
    expect(route).toMatchObject({ id: "pink_line_route", displayName: "Pink line", enabled: false });
    expect(route.fullLayerIds).toBeUndefined();
    expect(route.name).toBeUndefined();
    expect(ctx._animations[contentId]).toBe(false);
    expect(ctx._animations[parkingId]).toBe(false);
    expect(ctx._pendingLayerOps).toBe(0);
    expect(ctx._pendingAnimationOps).toBe(0);
  });

  test("clears animations only for rows that changed from enabled to disabled", async () => {
    const alreadyOffId = "nli.already_off";
    const ctx = makeExclusiveLayerContext([
      {
        id: "nli",
        enabled: true,
        layers: [
          { id: "shared", displayName: "Shared", enabled: true },
          { id: "old_story", displayName: "Old story", enabled: true },
          { id: "already_off", displayName: "Already off", enabled: false },
        ],
      },
    ]);
    ctx._animations = {
      [sharedId]: true,
      [oldId]: true,
      [alreadyOffId]: true,
    };

    const result = await setEnabledLayerIds(ctx, [sharedId]);

    expect(result).toEqual({ ok: true });
    expect(ctx._animations[oldId]).toBe(false);
    expect(ctx._animations[sharedId]).toBe(true);
    expect(ctx._animations[alreadyOffId]).toBe(true);
    const animationCall = fetchBodies().find((call) => call.body && call.body.animations);
    expect(animationCall.body.animations[oldId]).toBe(false);
    expect(animationCall.body.animations[sharedId]).toBe(true);
    expect(animationCall.body.animations[alreadyOffId]).toBe(true);
    expect(ctx._pendingLayerOps).toBe(0);
    expect(ctx._pendingAnimationOps).toBe(0);
  });

  test("rolls back the optimistic snapshot when the command and fallback both fail", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const initial = storyGroups();
    const ctx = makeExclusiveLayerContext(initial);
    ctx._animations = { [oldId]: true, [sharedId]: true };
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/command/")) return jsonResult({ error: "command failed" }, false);
      return jsonResult({ error: "patch failed" }, false);
    });

    const result = await setEnabledLayerIds(ctx, [sharedId, newId]);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.stale).toBeUndefined();
    expect(isFullLayerEnabled(ctx._layerGroups, sharedId)).toBe(true);
    expect(isFullLayerEnabled(ctx._layerGroups, oldId)).toBe(true);
    expect(isFullLayerEnabled(ctx._layerGroups, newId)).toBe(false);
    expect(ctx._animations[oldId]).toBe(true);
    expect(ctx._pendingLayerOps).toBe(0);
    expect(ctx._pendingAnimationOps).toBe(0);
    expect(toggleCommands()).toHaveLength(1);
    expect(fetchBodies().some((call) => !call.url.includes("/command/"))).toBe(true);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("does not roll back a newer desired set when an older flush fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = makeExclusiveLayerContext(storyGroups());
    ctx._animations = { [oldId]: true, [sharedId]: true };
    let releaseFirst;
    let commandCount = 0;
    global.fetch = vi.fn((url, init) => {
      const isCommand = String(url).includes("/command/");
      const body = init?.body ? JSON.parse(init.body) : null;
      if (isCommand) {
        commandCount += 1;
        if (commandCount === 1) {
          return new Promise((resolve) => {
            releaseFirst = () => resolve(jsonResult({ error: "command failed" }, false));
          });
        }
        return Promise.resolve(jsonResult({
          ok: true,
          layerGroups: JSON.parse(JSON.stringify(ctx._layerGroups)),
        }));
      }
      if (body && body.animations) return Promise.resolve(jsonResult({ ok: true }));
      return Promise.resolve(jsonResult({ error: "patch failed" }, false));
    });

    const first = setEnabledLayerIds(ctx, [sharedId]);
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const second = setEnabledLayerIds(ctx, [sharedId, newId]);
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.ok).toBe(false);
    expect(firstResult.stale).toBe(true);
    expect(firstResult.error).toBeTruthy();
    expect(secondResult).toEqual({ ok: true });
    for (const snapshot of ctx.snapshots) {
      expect(isFullLayerEnabled(snapshot, sharedId)).toBe(true);
    }
    expect(isFullLayerEnabled(ctx._layerGroups, sharedId)).toBe(true);
    expect(isFullLayerEnabled(ctx._layerGroups, oldId)).toBe(false);
    expect(isFullLayerEnabled(ctx._layerGroups, newId)).toBe(true);
    expect(isFullLayerEnabled(ctx._layerPatchLastAcked, sharedId)).toBe(true);
    expect(ctx._animations[oldId]).toBe(false);
    expect(ctx._animations[sharedId]).toBe(true);
    expect(ctx._pendingLayerOps).toBe(0);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("reports a superseded success without applying a stale snapshot", async () => {
    const ctx = makeExclusiveLayerContext(storyGroups());
    ctx._animations = { [oldId]: true, [sharedId]: true };
    let releaseFirst;
    let commandCount = 0;
    global.fetch = vi.fn((url) => {
      if (!String(url).includes("/command/")) {
        return Promise.resolve(jsonResult({ ok: true }));
      }
      commandCount += 1;
      if (commandCount === 1) {
        return new Promise((resolve) => {
          releaseFirst = () => resolve(jsonResult({
            ok: true,
            layerGroups: [
              {
                id: "nli",
                enabled: false,
                layers: [
                  { id: "shared", displayName: "Shared", enabled: false },
                  { id: "old_story", displayName: "Old story", enabled: false },
                  { id: "new_story", displayName: "New story", enabled: false },
                ],
              },
            ],
          }));
        });
      }
      return Promise.resolve(jsonResult({
        ok: true,
        layerGroups: JSON.parse(JSON.stringify(ctx._layerGroups)),
      }));
    });

    const first = setEnabledLayerIds(ctx, [sharedId]);
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const second = setEnabledLayerIds(ctx, [sharedId, oldId, newId]);
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual({ ok: true, stale: true });
    expect(secondResult).toEqual({ ok: true });
    for (const snapshot of ctx.snapshots) {
      expect(isFullLayerEnabled(snapshot, sharedId)).toBe(true);
    }
    expect(isFullLayerEnabled(ctx._layerGroups, sharedId)).toBe(true);
    expect(isFullLayerEnabled(ctx._layerGroups, oldId)).toBe(true);
    expect(isFullLayerEnabled(ctx._layerGroups, newId)).toBe(true);
    expect(isFullLayerEnabled(ctx._layerPatchLastAcked, sharedId)).toBe(true);
    expect(ctx._animations[oldId]).toBe(true);
    expect(ctx._animations[sharedId]).toBe(true);
    expect(ctx._pendingLayerOps).toBe(0);
  });

  test("facade delegates to the action and fails when the table is missing", async () => {
    const mod = await import("../../frontend/src/shared/OTEFDataContext.js");
    const result = await mod.OTEFDataContext.setEnabledLayerIds([sharedId]);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

