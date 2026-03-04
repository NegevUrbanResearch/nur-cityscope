const { createAnimationRuntime } = require('../../frontend/src/shared/animation-runtime');

describe('animation-runtime', () => {
  test('global clock produces monotonic phase by speed', () => {
    const rt = createAnimationRuntime(() => 1000);
    rt.setSpeed('october_7th.חדירה_לישוב-ציר', 40);
    const p1 = rt.getPhasePx('october_7th.חדירה_לישוב-ציר');

    rt._setNowProvider(() => 1100);
    const p2 = rt.getPhasePx('october_7th.חדירה_לישוב-ציר');

    expect(p2).toBeGreaterThan(p1);
  });
});

