function loadActionsWithApi(updateAnimationsImpl) {
  jest.resetModules();
  global.window = { OTEFDataContextInternals: {} };
  global.OTEF_API = {
    updateAnimations: updateAnimationsImpl || jest.fn().mockResolvedValue({ ok: true }),
  };
  global.OTEF_MESSAGE_TYPES = { VELOCITY_UPDATE: 'otef_velocity_update' };

  require('../../frontend/js/shared/otef-data-context/OTEFDataContext-actions.js');
  return window.OTEFDataContextInternals.actions;
}

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
    const actions = loadActionsWithApi();
    const ctx = makeMockContextWithAnimations({});
    const ids = ['october_7th.חדירה_לישוב-ציר', 'october_7th.מאבק_וגבורה_ציר'];

    const result = await actions.setLayerAnimations(ctx, ids, true);

    expect(result.ok).toBe(true);
    expect(ctx._animations[ids[0]]).toBe(true);
    expect(ctx._animations[ids[1]]).toBe(true);
  });
});
