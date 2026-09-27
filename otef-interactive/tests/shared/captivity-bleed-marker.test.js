import { describe, expect, it } from "vitest";
import {
  BIBAS_BALLOON_ORANGE,
  BIBAS_CAPTIVITY_PIDS,
  CAPTIVITY_BLEED_GRADIENT_STOPS,
  CAPTIVITY_BLOOD_RGB,
  RIBBON_YELLOW,
  buildCaptivityBleedImageSpec,
  createCaptivityBleedImageData,
  paintCaptivityBleedMarker,
} from "../../frontend/src/shared/captivity-bleed-marker.js";

function samplePixel(imageData, x, y) {
  const i = (Math.floor(y) * imageData.width + Math.floor(x)) * 4;
  return {
    r: imageData.data[i],
    g: imageData.data[i + 1],
    b: imageData.data[i + 2],
    a: imageData.data[i + 3],
  };
}

function redness(pixel) {
  return pixel.r - Math.max(pixel.g, pixel.b);
}

describe("captivity bleed marker painter", () => {
  it("exports the approved ribbon yellow, blood RGB, and gradient stops", () => {
    expect(RIBBON_YELLOW).toBe("#FFD100");
    expect(CAPTIVITY_BLOOD_RGB).toEqual({ r: 154, g: 36, b: 30 });
    expect(CAPTIVITY_BLEED_GRADIENT_STOPS).toEqual([
      [0, "rgba(154, 36, 30, 0.96)"],
      [0.22, "rgba(154, 36, 30, 0.7)"],
      [0.4, "rgba(154, 36, 30, 0.34)"],
      [0.58, "rgba(154, 36, 30, 0.14)"],
      [0.78, "rgba(154, 36, 30, 0.04)"],
      [1, "rgba(154, 36, 30, 0)"],
    ]);
  });

  it("paints a top-heavy blood stain over ribbon yellow", () => {
    let imageData;
    try {
      imageData = createCaptivityBleedImageData({ radius: 24 });
    } catch (error) {
      if (String(error?.message || error).includes("2D canvas")) {
        expect(CAPTIVITY_BLEED_GRADIENT_STOPS[0][1]).toContain("0.96");
        expect(CAPTIVITY_BLEED_GRADIENT_STOPS.at(-1)[1]).toContain(", 0)");
        return;
      }
      throw error;
    }

    const cx = imageData.width / 2;
    const cy = imageData.height / 2;
    const r = 24;
    const top = samplePixel(imageData, cx, cy - r * 0.55);
    const bottom = samplePixel(imageData, cx, cy + r * 0.55);

    expect(redness(top)).toBeGreaterThan(redness(bottom));
    expect(bottom.r).toBeGreaterThan(200);
    expect(bottom.g).toBeGreaterThan(180);
    expect(bottom.b).toBeLessThan(80);
  });

  it("fills ribbon yellow before clipping the gradient", () => {
    const calls = [];
    const gradient = {
      addColorStop(offset, color) {
        calls.push(["stop", offset, color]);
      },
    };
    const ctx = {
      beginPath() {
        calls.push(["beginPath"]);
      },
      arc(...args) {
        calls.push(["arc", ...args]);
      },
      fill() {
        calls.push(["fill", this.fillStyle]);
      },
      stroke() {
        calls.push(["stroke", this.strokeStyle, this.lineWidth]);
      },
      clip() {
        calls.push(["clip"]);
      },
      save() {
        calls.push(["save"]);
      },
      restore() {
        calls.push(["restore"]);
      },
      createRadialGradient(...args) {
        calls.push(["gradient", ...args]);
        return gradient;
      },
      fillStyle: null,
      strokeStyle: null,
      lineWidth: 0,
    };

    paintCaptivityBleedMarker(ctx, { cx: 10, cy: 10, r: 8 });

    const fillYellow = calls.findIndex(
      (entry) => entry[0] === "fill" && String(entry[1]).toUpperCase() === "#FFD100",
    );
    const clipAt = calls.findIndex((entry) => entry[0] === "clip");
    const gradientAt = calls.findIndex((entry) => entry[0] === "gradient");
    const strokeAt = calls.findIndex((entry) => entry[0] === "stroke");

    expect(fillYellow).toBeGreaterThanOrEqual(0);
    expect(clipAt).toBeGreaterThan(fillYellow);
    expect(gradientAt).toBeGreaterThan(clipAt);
    expect(strokeAt).toBeGreaterThan(gradientAt);
    expect(calls[strokeAt][1].toLowerCase()).toBe("#ffffff");
    expect(calls[strokeAt][2]).toBeCloseTo(8 * 0.125);
  });

  it("exports the Bibas balloon orange and closed captivity pids", () => {
    expect(BIBAS_BALLOON_ORANGE).toBe("#FF8C00");
    expect(BIBAS_CAPTIVITY_PIDS).toEqual(["551", "552", "553"]);
  });

  it("paints the provided disc fill before the blood stain", () => {
    const calls = [];
    const gradient = {
      addColorStop(offset, color) {
        calls.push(["stop", offset, color]);
      },
    };
    const ctx = {
      beginPath() {
        calls.push(["beginPath"]);
      },
      arc(...args) {
        calls.push(["arc", ...args]);
      },
      fill() {
        calls.push(["fill", this.fillStyle]);
      },
      stroke() {
        calls.push(["stroke", this.strokeStyle, this.lineWidth]);
      },
      clip() {
        calls.push(["clip"]);
      },
      save() {
        calls.push(["save"]);
      },
      restore() {
        calls.push(["restore"]);
      },
      createRadialGradient(...args) {
        calls.push(["gradient", ...args]);
        return gradient;
      },
      fillStyle: null,
      strokeStyle: null,
      lineWidth: 0,
    };

    paintCaptivityBleedMarker(ctx, { cx: 10, cy: 10, r: 8, fillColor: BIBAS_BALLOON_ORANGE });

    const fillOrange = calls.findIndex(
      (entry) => entry[0] === "fill" && String(entry[1]).toUpperCase() === BIBAS_BALLOON_ORANGE,
    );
    const clipAt = calls.findIndex((entry) => entry[0] === "clip");
    expect(fillOrange).toBeGreaterThanOrEqual(0);
    expect(clipAt).toBeGreaterThan(fillOrange);
  });

  it("gives balloon-orange bleed a distinct image id from ribbon yellow", () => {
    const yellow = buildCaptivityBleedImageSpec({ radius: 8 });
    const orange = buildCaptivityBleedImageSpec({ radius: 8, fillColor: BIBAS_BALLOON_ORANGE });
    expect(yellow.imageId).not.toBe(orange.imageId);
    expect(orange.fillColor.toUpperCase()).toBe(BIBAS_BALLOON_ORANGE);
    expect(orange.imageId.toUpperCase()).toContain("FF8C00");
  });
});
