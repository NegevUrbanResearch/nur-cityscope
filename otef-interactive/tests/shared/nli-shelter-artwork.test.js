import { afterEach, expect, test, vi } from "vitest";
import { paintShelterArtwork } from "../../frontend/src/shared/nli-shelter-artwork.js";

afterEach(() => vi.unstubAllGlobals());

function strokeWidths(bodyWidthPx) {
  vi.stubGlobal("Path2D", class { constructor(data) { this.data = data; } });
  let horizontalScale = 1;
  const strokes = [];
  const context = {
    save() {}, restore() {}, translate() {}, fill() {},
    scale(x) { horizontalScale *= x; },
    stroke(path) { strokes.push({ path: path.data, width: this.lineWidth * horizontalScale }); },
  };
  paintShelterArtwork(context, { cx: 0, cy: 0, bodyWidthPx, bodyColor: "#fff7ed" });
  return strokes;
}

test("miniature keeps structural edges strong enough to survive downscaling", () => {
  const strokes = strokeWidths(24);
  const doorway = strokes[0], seam = strokes[1], outline = strokes.at(-1);
  expect(doorway.width).toBeGreaterThanOrEqual(0.85);
  expect(seam.width).toBeGreaterThanOrEqual(1);
  expect(outline.width).toBeGreaterThanOrEqual(1.5);
});

test("detailed shelter retains its fine illustration strokes", () => {
  const strokes = strokeWidths(80);
  expect(strokes.at(-1).width).toBeCloseTo(1.1 * 80 / 116);
});
