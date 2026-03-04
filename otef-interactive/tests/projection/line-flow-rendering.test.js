const AdvancedStyleDrawingModule = require('../../frontend/src/map-utils/advanced-style-drawing');
const AdvancedStyleDrawing =
  AdvancedStyleDrawingModule.default || AdvancedStyleDrawingModule;

function makeMockCanvasCtx() {
  return {
    lineDashOffset: 0,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    createPattern: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
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

describe('projection line flow rendering', () => {
  test('drawLine applies lineDashOffset when flow animation enabled', () => {
    const ctx = makeMockCanvasCtx();
    const drawer = new AdvancedStyleDrawing();

    drawer.drawCommands(
      ctx,
      [
        {
          type: 'drawLine',
          geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] },
          symbol: {
            symbolLayers: [{ type: 'stroke', color: '#f68c28', width: 2 }],
          },
          animation: { flow: { enabled: true, phasePx: 8, dashArray: [10, 14] } },
        },
      ],
      makeViewContext(),
    );

    expect(ctx.lineDashOffset).toBe(8);
  });
});
