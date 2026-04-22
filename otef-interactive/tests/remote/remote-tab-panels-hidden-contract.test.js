import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Regression: `.remote-tab-panel { display:flex }` must not keep `[hidden]` panels
 * in the flex layout (UA [hidden] loses to author rules of equal-ish specificity).
 */
test("remote-styles: hidden tab panels are display:none (out of layout)", () => {
  const css = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/css/remote-styles.css"),
    "utf8",
  );
  expect(css).toMatch(/\.remote-tab-panel\[hidden\]\s*\{[^}]*display:\s*none/s);
});
