let setLayerAnimations;
let zoom;

beforeEach(async () => {
  vi.resetModules();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  });

  const mod = await import('../../frontend/src/shared/otef-data-context/OTEFDataContext-actions.js');
  setLayerAnimations = mod.setLayerAnimations;
  zoom = mod.zoom;
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
    };

    await zoom(ctx, 14);

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestBody.action).toBe('zoom');
    expect(requestBody.base_viewport).toEqual(viewport);
  });
});
