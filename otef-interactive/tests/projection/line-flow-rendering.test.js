const AdvancedStyleDrawingModule = require('../../frontend/src/map-utils/advanced-style-drawing');
const AdvancedStyleDrawing =
  AdvancedStyleDrawingModule.default || AdvancedStyleDrawingModule;

function makeMockCanvasCtx() {
  return {
    lineDashOffset: 0,
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    setLineDash: jest.fn(),
    createPattern: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    arc: jest.fn(),
    rect: jest.fn(),
    fill: jest.fn(),
    closePath: jest.fn(),
    fillText: jest.fn(),
    strokeText: jest.fn(),
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
