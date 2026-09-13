import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/processed/layers/nli/styles.json",
);

function asHexOrRgb(color) {
  if (typeof color !== "string") return "";
  const c = color.trim().toLowerCase();
  if (c === "#873e23") return "#873e23";
  if (c.replace(/\s/g, "") === "rgb(135,62,35)") return "#873e23";
  return c;
}

function strokeLayers(entry) {
  const symbolLayers = entry?.defaultSymbol?.symbolLayers || [];
  return symbolLayers.filter((layer) => layer?.type === "stroke");
}

describe("live nli processed styles afternoon lock", () => {
  it("matches 232 brown and people_names IR when processed styles.json is present", () => {
    if (!fs.existsSync(stylesPath)) {
      console.warn(`[afternoon-lock] missing ${stylesPath}; run Task 2 prep on the lab machine`);
      return;
    }
    const styles = JSON.parse(fs.readFileSync(stylesPath, "utf8"));
    const highway = styles["ציר_232"];
    expect(highway).toBeTruthy();
    const strokes = strokeLayers(highway);
    expect(strokes.length).toBeGreaterThan(0);
    const stroke = strokes[0];
    expect(asHexOrRgb(stroke.color)).toBe("#873e23");
    expect(Number(stroke.opacity)).toBe(1);
    expect(Number(stroke.width)).toBeCloseTo(2.0 * (96 / 72), 2);

    const names = styles.people_names;
    expect(names).toBeTruthy();
    const labels = names.labels || {};
    expect(Number(labels.size)).toBe(8);
    expect(Number(labels.haloSize)).toBeCloseTo(0.12, 5);
    expect(labels.field).toBe("hebrew_name");
    expect(labels.offsetArrayProperty).toBe("otef_map_text_offset_em");
    expect(labels.textRotationAlignment).toBe("map");
  });
});
