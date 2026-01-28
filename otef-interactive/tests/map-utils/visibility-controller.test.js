const { shouldLayerBeVisible } = require('../../frontend/js/map-utils/visibility-controller');
const { computeZoomRange } = require('../../frontend/js/map-utils/visibility-utils');

describe('visibility-controller: shouldLayerBeVisible', () => {
  function makeHelper(enabled) {
    return {
      getLayerState: (fullLayerId) => ({
        id: fullLayerId,
        enabled
      })
    };
  }

  test('returns false when fullLayerId or zoom are invalid', () => {
    expect(shouldLayerBeVisible({ fullLayerId: '', zoom: 10 })).toBe(false);
    expect(shouldLayerBeVisible({ fullLayerId: 'a.b', zoom: NaN })).toBe(false);
  });

  test('returns false when zoom is outside scaleRange', () => {
    const scaleRange = { minScale: 1000, maxScale: 100 }; // just sample numbers
    const zoomRange = computeZoomRange(scaleRange);

    // Pick zooms well outside the range
    expect(
      shouldLayerBeVisible({
        fullLayerId: 'g.l',
        scaleRange,
        zoom: (zoomRange.minZoom || 0) - 2
      })
    ).toBe(false);

    expect(
      shouldLayerBeVisible({
        fullLayerId: 'g.l',
        scaleRange,
        zoom: (zoomRange.maxZoom || 10) + 2
      })
    ).toBe(false);
  });

  test('returns false when layerStateHelper reports disabled', () => {
    const scaleRange = null; // no zoom restriction
    const helper = makeHelper(false);

    expect(
      shouldLayerBeVisible({
        fullLayerId: 'group.layer',
        scaleRange,
        zoom: 10,
        layerStateHelper: helper
      })
    ).toBe(false);
  });

  test('returns true when zoom is in range and layer is enabled', () => {
    const scaleRange = null;
    const helper = makeHelper(true);

    expect(
      shouldLayerBeVisible({
        fullLayerId: 'group.layer',
        scaleRange,
        zoom: 10,
        layerStateHelper: helper
      })
    ).toBe(true);
  });
});

