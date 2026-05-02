let setLayerAnimations;
let zoom;
let pan;
let updateViewportFromUI;
let computePanViewport;

beforeEach(async () => {
  vi.resetModules();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  });

  const mod = await import('../../frontend/src/shared/otef-data-context/OTEFDataContext-actions.js');
  setLayerAnimations = mod.setLayerAnimations;
  zoom = mod.zoom;
  pan = mod.pan;
  updateViewportFromUI = mod.updateViewportFromUI;
  computePanViewport = mod.computePanViewport;
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
});
