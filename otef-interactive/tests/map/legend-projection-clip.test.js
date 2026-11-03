// @vitest-environment jsdom

import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("keeps the projection host's real overflow clip rectangular while GIS keeps rounded corners", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../frontend/css/styles.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  const projection = document.createElement("div");
  projection.className = "map-legend map-legend-projection";
  const gis = document.createElement("div");
  gis.className = "map-legend map-legend-gis";
  document.body.append(projection, gis);

  const projectionStyle = getComputedStyle(projection);
  const gisStyle = getComputedStyle(gis);
  expect(projectionStyle.overflow).toBe("hidden");
  expect(Number.parseFloat(projectionStyle.borderRadius)).toBe(0);
  expect(gisStyle.overflow).toBe("hidden");
  expect(Number.parseFloat(gisStyle.borderRadius)).toBe(7);
  projection.remove();
  gis.remove();
  style.remove();
});
