const StyleApplicator = require('../../frontend/js/map-utils/style-applicator');

describe('StyleApplicator.getLeafletStyle (simple renderer)', () => {
  test('returns a function that produces expected default style', () => {
    const layerConfig = {
      style: {
        renderer: 'simple',
        defaultStyle: {
          fillColor: '#123456',
          fillOpacity: 0.5,
          strokeColor: '#654321',
          strokeWidth: 2,
          strokeOpacity: 0.8
        }
      }
    };

    const styleFn = StyleApplicator.getLeafletStyle(layerConfig);
    const result = styleFn({});

    expect(result.fillColor).toBe('#123456');
    expect(result.fillOpacity).toBeCloseTo(0.5);
    expect(result.color).toBe('#654321');
    // strokeWidth is converted from pt to px internally
    expect(result.weight).toBeGreaterThan(2);
    expect(result.opacity).toBeCloseTo(0.8);
  });

  test('falls back to sensible defaults when style is missing', () => {
    const styleFn = StyleApplicator.getLeafletStyle(null);
    const result = styleFn({});

    expect(result.fillColor).toBe('#808080');
    expect(result.color).toBe('#000000');
  });
});

