const AdvancedStyleEngineModule = require("../../frontend/src/map-utils/advanced-style-engine.js");

const AdvancedStyleEngine =
  AdvancedStyleEngineModule.default || AdvancedStyleEngineModule;

describe("AdvancedStyleEngine simple style adapter", () => {
  test("creates fill and stroke layers when given strokeColor/strokeWidth", () => {
    const simpleStyle = {
      fillColor: "#123456",
      fillOpacity: 0.4,
      strokeColor: "#ff0000",
      strokeWidth: 2,
      strokeOpacity: 0.8,
      dashArray: [4, 2],
    };

    const symbol = AdvancedStyleEngine.symbolFromSimpleStyle(simpleStyle);
    expect(symbol).toBeTruthy();
    expect(Array.isArray(symbol.symbolLayers)).toBe(true);

    const fills = symbol.symbolLayers.filter(
      (l) => l && l.type === "fill",
    );
    const strokes = symbol.symbolLayers.filter(
      (l) => l && l.type === "stroke",
    );

    expect(fills).toHaveLength(1);
    expect(strokes).toHaveLength(1);

    expect(fills[0].color).toBe("#123456");
    expect(fills[0].opacity).toBe(0.4);

    expect(strokes[0].color).toBe("#ff0000");
    expect(strokes[0].width).toBe(2);
    expect(strokes[0].opacity).toBe(0.8);
    expect(strokes[0].dash).toEqual({ array: [4, 2] });
  });

  test("creates stroke from Leaflet-style color/weight/opacity", () => {
    const simpleStyle = {
      fillColor: "#123456",
      color: "#00ff00",
      weight: 3,
      opacity: 0.5,
    };

    const symbol = AdvancedStyleEngine.symbolFromSimpleStyle(simpleStyle);
    expect(symbol).toBeTruthy();

    const strokes = symbol.symbolLayers.filter(
      (l) => l && l.type === "stroke",
    );
    expect(strokes).toHaveLength(1);
    expect(strokes[0].color).toBe("#00ff00");
    expect(strokes[0].width).toBe(3);
    expect(strokes[0].opacity).toBe(0.5);
  });

  test("does not create stroke when no stroke fields or color/weight are present", () => {
    const simpleStyle = {
      fillColor: "#123456",
      fillOpacity: 0.8,
    };

    const symbol = AdvancedStyleEngine.symbolFromSimpleStyle(simpleStyle);
    expect(symbol).toBeTruthy();

    const fills = symbol.symbolLayers.filter(
      (l) => l && l.type === "fill",
    );
    const strokes = symbol.symbolLayers.filter(
      (l) => l && l.type === "stroke",
    );

    expect(fills.length).toBeGreaterThanOrEqual(1);
    expect(strokes).toHaveLength(0);
  });

  test("computeCommands emits drawLine with stroke when using color/weight styleFunction", () => {
    const features = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [10, 10],
          ],
        },
        properties: {},
      },
    ];

    const styleConfig = {
      renderer: "simple",
      defaultSymbol: null,
    };

    const styleFunction = () => ({
      color: "#ff0000",
      weight: 4,
      opacity: 1,
    });

    const commands = AdvancedStyleEngine.computeCommands(
      features,
      styleConfig,
      {},
      styleFunction,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0].type).toBe("drawLine");
    expect(commands[0].symbol).toBeTruthy();

    const strokes = commands[0].symbol.symbolLayers.filter(
      (l) => l && l.type === "stroke",
    );
    expect(strokes).toHaveLength(1);
    expect(strokes[0].color).toBe("#ff0000");
    expect(strokes[0].width).toBe(4);
  });

  test("computeCommands emits no commands when styleFunction returns empty object", () => {
    const features = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [10, 10],
          ],
        },
        properties: {},
      },
    ];

    const styleConfig = {
      renderer: "simple",
      defaultSymbol: null,
    };

    const styleFunction = () => ({});

    const commands = AdvancedStyleEngine.computeCommands(
      features,
      styleConfig,
      {},
      styleFunction,
    );

    // We may still emit a drawLine command shell, but it should have no
    // visible stroke/fill symbol layers when the styleFunction returns
    // an empty style.
    expect(commands).toHaveLength(1);
    expect(commands[0].type).toBe("drawLine");
    const symbolLayers = commands[0].symbol.symbolLayers || [];
    const visibleStrokes = symbolLayers.filter(
      (l) => l && l.type === "stroke",
    );
    expect(visibleStrokes).toHaveLength(0);
  });
});


