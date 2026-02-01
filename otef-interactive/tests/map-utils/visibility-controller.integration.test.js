const { computeZoomRange } = require('../../frontend/js/map-utils/visibility-utils');
const { shouldLayerBeVisible } = require('../../frontend/js/map-utils/visibility-controller');

describe('visibility-controller integration-style behavior', () => {
  function makeLayerStateHelper(enabledIds) {
    return {
      getLayerState(fullLayerId) {
        return {
          group: { id: fullLayerId.split('.')[0] },
          layer: { id: fullLayerId.split('.')[1] },
          enabled: enabledIds.has(fullLayerId),
        };
      },
    };
  }

  test('layer visibility responds to zoom + enabled state', () => {
    const fullLayerId = 'group.layer';
    const scaleRange = { minScale: 50000, maxScale: 5000 };
    const zoomRange = computeZoomRange(scaleRange);

    // Sanity: zoomRange must be consistent
    expect(zoomRange).not.toBeNull();

    const helperEnabled = makeLayerStateHelper(new Set([fullLayerId]));
    const helperDisabled = makeLayerStateHelper(new Set());

    const midZoom = (zoomRange.minZoom + zoomRange.maxZoom) / 2;

    // Enabled + in-range → visible
    expect(
      shouldLayerBeVisible({
        fullLayerId,
        scaleRange,
        zoom: midZoom,
        layerStateHelper: helperEnabled,
      })
    ).toBe(true);

    // Disabled + in-range → hidden
    expect(
      shouldLayerBeVisible({
        fullLayerId,
        scaleRange,
        zoom: midZoom,
        layerStateHelper: helperDisabled,
      })
    ).toBe(false);

    // Enabled but zoom below min → hidden
    expect(
      shouldLayerBeVisible({
        fullLayerId,
        scaleRange,
        zoom: zoomRange.minZoom - 1,
        layerStateHelper: helperEnabled,
      })
    ).toBe(false);

    // Enabled but zoom above max → hidden
    expect(
      shouldLayerBeVisible({
        fullLayerId,
        scaleRange,
        zoom: zoomRange.maxZoom + 1,
        layerStateHelper: helperEnabled,
      })
    ).toBe(false);
  });
});

