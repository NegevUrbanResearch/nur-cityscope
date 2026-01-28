const {
  SCALE_AT_ZOOM_0,
  scaleToZoom,
  computeZoomRange,
  isZoomInRange
} = require('../../frontend/js/map-utils/visibility-utils');

describe('visibility-utils: scaleToZoom', () => {
  test('returns null for falsy scale', () => {
    expect(scaleToZoom(null)).toBeNull();
    expect(scaleToZoom(undefined)).toBeNull();
    expect(scaleToZoom(0)).toBeNull();
  });

  test('converts scale to zoom using SCALE_AT_ZOOM_0', () => {
    // At scale = SCALE_AT_ZOOM_0, zoom should be 0
    expect(scaleToZoom(SCALE_AT_ZOOM_0)).toBeCloseTo(0);

    // At half the scale denominator, zoom should be 1
    expect(scaleToZoom(SCALE_AT_ZOOM_0 / 2)).toBeCloseTo(1);

    // At 2^4 smaller denominator, zoom should be 4
    expect(scaleToZoom(SCALE_AT_ZOOM_0 / 16)).toBeCloseTo(4);
  });
});

describe('visibility-utils: computeZoomRange', () => {
  test('returns null when scaleRange is missing', () => {
    expect(computeZoomRange(null)).toBeNull();
    expect(computeZoomRange(undefined)).toBeNull();
  });

  test('computes minZoom and maxZoom when scales are provided', () => {
    const scaleRange = {
      minScale: SCALE_AT_ZOOM_0,       // zoom 0
      maxScale: SCALE_AT_ZOOM_0 / 16   // zoom 4
    };

    const range = computeZoomRange(scaleRange);
    expect(range.minZoom).toBeCloseTo(0);
    expect(range.maxZoom).toBeCloseTo(4);
  });

  test('handles missing minScale or maxScale as unbounded', () => {
    const onlyMin = computeZoomRange({ minScale: SCALE_AT_ZOOM_0 });
    expect(onlyMin.minZoom).toBeCloseTo(0);
    expect(onlyMin.maxZoom).toBeNull();

    const onlyMax = computeZoomRange({ maxScale: SCALE_AT_ZOOM_0 / 8 });
    expect(onlyMax.minZoom).toBeNull();
    expect(onlyMax.maxZoom).toBeCloseTo(3);
  });
});

describe('visibility-utils: isZoomInRange', () => {
  test('treats undefined range as always in range', () => {
    expect(isZoomInRange(5, null)).toBe(true);
    expect(isZoomInRange(5, undefined)).toBe(true);
  });

  test('applies both minZoom and maxZoom when provided', () => {
    const range = { minZoom: 2, maxZoom: 4 };

    expect(isZoomInRange(1.9, range)).toBe(false);
    expect(isZoomInRange(2, range)).toBe(true);
    expect(isZoomInRange(3, range)).toBe(true);
    expect(isZoomInRange(4, range)).toBe(true);
    expect(isZoomInRange(4.1, range)).toBe(false);
  });

  test('handles open-ended ranges', () => {
    const minOnly = { minZoom: 3, maxZoom: null };
    expect(isZoomInRange(2.9, minOnly)).toBe(false);
    expect(isZoomInRange(3, minOnly)).toBe(true);
    expect(isZoomInRange(10, minOnly)).toBe(true);

    const maxOnly = { minZoom: null, maxZoom: 5 };
    expect(isZoomInRange(0, maxOnly)).toBe(true);
    expect(isZoomInRange(5, maxOnly)).toBe(true);
    expect(isZoomInRange(5.1, maxOnly)).toBe(false);
  });
}
);

