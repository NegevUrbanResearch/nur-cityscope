import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const artworkPath = new URL("../../frontend/img/projection-signs/road-232-dark.svg", import.meta.url);

describe("Road 232 Dark artwork", () => {
  test("keeps the source-traced 232 numeral outlines as local SVG paths", async () => {
    const svg = await readFile(artworkPath, "utf8");
    const numeralPath = svg.match(/<path fill="#f5f7f5" d="([^"]+)"\s*\/>/)?.[1];
    expect(numeralPath).toBeTruthy();
    expect((numeralPath.match(/M/g) || [])).toHaveLength(3);
    expect(createHash("sha256").update(numeralPath).digest("hex"))
      .toBe("8319b836251d6b9a4742ffec69caeaf6b9d7456b6262e147cca5471d3752a55f");
    expect(svg).not.toMatch(/<text\b/i);
  });
});
