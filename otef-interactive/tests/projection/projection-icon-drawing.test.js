const AdvancedStyleEngineModule = require("../../frontend/src/map-utils/advanced-style-engine.js");
const AdvancedStyleDrawingModule = require("../../frontend/src/map-utils/advanced-style-drawing.js");

const AdvancedStyleEngine =
  AdvancedStyleEngineModule.default || AdvancedStyleEngineModule;
const AdvancedStyleDrawing =
  AdvancedStyleDrawingModule.default || AdvancedStyleDrawingModule;

function makeMockCanvasCtx() {
  return {
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  };
}

function makeViewContext() {
  return {
    coordToPixel: ([x, y]) => ({ x, y }),
    pixelRatio: 1,
    viewportWidth: 100,
    viewportHeight: 100,
    tileOrigin: { x: 0, y: 0 },
  };
}

describe("projection canvas icon drawing", () => {
  test("drawMarker uses _iconUrl/_iconSize styles to draw icons instead of circles", () => {
    const ctx = makeMockCanvasCtx();
    const drawer = new AdvancedStyleDrawing();

    const iconUrl = "https://example.com/memorial-icon.png";
    const size = 40;

    const simpleStyle = {
      _iconUrl: iconUrl,
      _iconSize: size,
    };

    const symbol = AdvancedStyleEngine.symbolFromSimpleStyle(simpleStyle);

    const helpers = {
      getIcon: vi.fn(() => ({
        img: {},
        loaded: true,
        failed: false,
      })),
    };

    drawer.drawCommands(
      ctx,
      [
        {
          type: "drawMarker",
          geometry: { type: "Point", coordinates: [10, 20] },
          symbol,
        },
      ],
      makeViewContext(),
      helpers,
    );

    expect(helpers.getIcon).toHaveBeenCalledWith(iconUrl);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    const args = ctx.drawImage.mock.calls[0];
    // args: [img, x, y, w, h]
    expect(args[3]).toBe(size);
    expect(args[4]).toBe(size);
  });
});

