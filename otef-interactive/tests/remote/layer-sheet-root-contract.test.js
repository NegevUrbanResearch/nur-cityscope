import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locks Task 6 default: HTML `#layerSheet` and constructor fallback stay aligned
 * (LayerSheetController is not safe to instantiate in node without a DOM stub).
 */
test("LayerSheetController default rootId remains layerSheet", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/remote/layer-sheet-controller.js"),
    "utf8",
  );
  expect(src).toMatch(/options\.rootId\s*\|\|\s*["']layerSheet["']/);
});
