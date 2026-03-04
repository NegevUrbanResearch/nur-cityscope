const AdvancedStyleEngineModule = require('../../frontend/src/map-utils/advanced-style-engine');
const AdvancedStyleEngine =
  AdvancedStyleEngineModule.default || AdvancedStyleEngineModule;

describe('AdvancedStyleEngine', () => {
  test('october_7th line style contains flow animation metadata', () => {
    const styles = require('../../public/processed/layers/october_7th/styles.json');
    const style = Object.values(styles).find(
      (entry) => entry && entry.type === 'line' && entry.animation?.type === 'flow',
    );

    expect(style).toBeTruthy();
    expect(style.type).toBe('line');
    expect(style.animation).toBeTruthy();
    expect(style.animation.type).toBe('flow');
  });

  describe('_resolveStyleSymbol', () => {
    test('uniqueValue: returns symbol for matching class value', () => {
      const styleConfig = {
        renderer: 'uniqueValue',
        uniqueValues: {
          field: 'zone_code',
          classes: [
            {
              value: 'R1',
              symbol: {
                symbolLayers: [{ type: 'fill', fillType: 'solid', color: '#f00' }]
              }
            },
            {
              value: 'C1',
              symbol: {
                symbolLayers: [{ type: 'fill', fillType: 'solid', color: '#0f0' }]
              }
            }
          ]
        }
      };

      const featureR1 = { properties: { zone_code: 'R1' }, geometry: {} };
      const symbolR1 = AdvancedStyleEngine._resolveStyleSymbol(
        featureR1,
        styleConfig,
        'uniqueValue'
      );
      expect(symbolR1).not.toBeNull();
      expect(symbolR1.symbolLayers).toHaveLength(1);
      expect(symbolR1.symbolLayers[0].color).toBe('#f00');

      const featureC1 = { properties: { zone_code: 'C1' }, geometry: {} };
      const symbolC1 = AdvancedStyleEngine._resolveStyleSymbol(
        featureC1,
        styleConfig,
        'uniqueValue'
      );
      expect(symbolC1).not.toBeNull();
      expect(symbolC1.symbolLayers[0].color).toBe('#0f0');
    });

    test('uniqueValue: returns symbol from simple style when class has style not advancedSymbol', () => {
      const styleConfig = {
        renderer: 'uniqueValue',
        uniqueValues: {
          field: 'code',
          classes: [
            {
              value: 'A',
              style: { fillColor: '#00f', strokeColor: '#000', strokeWidth: 1 }
            }
          ]
        }
      };

      const feature = { properties: { code: 'A' }, geometry: {} };
      const symbol = AdvancedStyleEngine._resolveStyleSymbol(
        feature,
        styleConfig,
        'uniqueValue'
      );
      expect(symbol).not.toBeNull();
      expect(symbol.symbolLayers).toBeDefined();
      expect(symbol.symbolLayers.some((l) => l.type === 'fill' && l.color === '#00f')).toBe(true);
    });

    test('uniqueValue: returns defaultStyle-derived symbol when no class matches', () => {
      const styleConfig = {
        renderer: 'uniqueValue',
        defaultStyle: { fillColor: '#888', strokeColor: '#000' },
        uniqueValues: {
          field: 'zone_code',
          classes: [{ value: 'R1', symbol: { symbolLayers: [{ type: 'fill', color: '#f00' }] } }]
        }
      };

      const feature = { properties: { zone_code: 'UNKNOWN' }, geometry: {} };
      const symbol = AdvancedStyleEngine._resolveStyleSymbol(
        feature,
        styleConfig,
        'uniqueValue'
      );
      expect(symbol).not.toBeNull();
      expect(symbol.symbolLayers).toBeDefined();
      expect(symbol.symbolLayers.some((l) => l.type === 'fill' && l.color === '#888')).toBe(true);
    });

    test('simple renderer: returns defaultSymbol when present', () => {
      const styleConfig = {
        renderer: 'simple',
        defaultSymbol: {
          symbolLayers: [{ type: 'fill', fillType: 'solid', color: '#abc' }]
        }
      };

      const feature = { properties: {}, geometry: {} };
      const symbol = AdvancedStyleEngine._resolveStyleSymbol(
        feature,
        styleConfig,
        'simple'
      );
      expect(symbol).not.toBeNull();
      expect(symbol.symbolLayers[0].color).toBe('#abc');
    });

    test('simple renderer: returns defaultStyle-derived symbol when no defaultSymbol', () => {
      const styleConfig = {
        renderer: 'simple',
        defaultStyle: { fillColor: '#111', strokeWidth: 2 }
      };

      const feature = { properties: {}, geometry: {} };
      const symbol = AdvancedStyleEngine._resolveStyleSymbol(
        feature,
        styleConfig,
        'simple'
      );
      expect(symbol).not.toBeNull();
      expect(symbol.symbolLayers).toBeDefined();
      expect(symbol.symbolLayers.some((l) => l.type === 'fill' && l.color === '#111')).toBe(true);
    });
  });
});
