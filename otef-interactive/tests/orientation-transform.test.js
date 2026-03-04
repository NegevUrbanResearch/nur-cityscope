const {
  rotateViewerVectorToItm,
} = require("../frontend/src/shared/orientation-transform");

describe("orientation-transform", () => {
  test("0deg keeps vector unchanged", () => {
    const out = rotateViewerVectorToItm({ dx: 4, dy: -2 }, 0);
    expect(out.dx).toBeCloseTo(4);
    expect(out.dy).toBeCloseTo(-2);
  });

  test("90deg rotates viewer up to negative x in ITM frame", () => {
    const out = rotateViewerVectorToItm({ dx: 0, dy: 1 }, 90);
    expect(out.dx).toBeCloseTo(-1, 6);
    expect(out.dy).toBeCloseTo(0, 6);
  });

  test("invalid angle returns original vector", () => {
    const out = rotateViewerVectorToItm({ dx: 2, dy: 3 }, "bad");
    expect(out.dx).toBe(2);
    expect(out.dy).toBe(3);
  });

  test("invalid vector returns zero vector", () => {
    const out = rotateViewerVectorToItm(null, 30);
    expect(out).toEqual({ dx: 0, dy: 0 });
  });
});


