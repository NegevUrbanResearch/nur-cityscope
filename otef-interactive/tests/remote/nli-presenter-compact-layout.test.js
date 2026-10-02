import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const stylesheet = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend/css/nli-presenter.css",
);

describe("compact presenter layout", () => {
  it("stacks applied and browse markers above ordinary rail ticks", () => {
    const css = readFileSync(stylesheet, "utf8");
    expect(css).toMatch(/\.nli-presenter-rail-point \{[^}]*z-index\s*:\s*1/);
    expect(css).toMatch(/\.nli-presenter-rail-point\.is-current \{[^}]*z-index\s*:\s*3/);
    expect(css).toMatch(/\.nli-presenter-rail-point\.is-browse \{[^}]*z-index\s*:\s*4/);
  });
  it("reserves font-scaled tracks for the current time and wrapped localized transport labels", () => {
    const css = readFileSync(stylesheet, "utf8");
    expect(css).toContain("grid-template-rows:minmax(2.35em,auto) minmax(0,1fr) minmax(4.25em,auto)");
    expect(css).toMatch(/\.nli-presenter-text \{[^}]*overflow:auto/);
    expect(css).toMatch(/\.nli-presenter-controls \{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.25fr\) minmax\(0,1fr\)/);
  });
  test("lets the unavailable panel shrink into the staff viewport", () => {
    const css = readFileSync(stylesheet, "utf8");
    const compact = css.match(/@media\s*\(orientation\s*:\s*landscape\)\s*and\s*\(max-height\s*:\s*700px\)\s*\{([\s\S]*?)\n\}/)?.[1];
    const compactPortrait = css.match(/@media\s*\(max-height\s*:\s*700px\)\s*and\s*\(max-width\s*:\s*500px\)\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(compact, "compact landscape rules are present").toBeTruthy();
    expect(compactPortrait, "compact portrait rules are present").toBeTruthy();
    expect(compact).toMatch(/#player\.is-presenter-timeline\s+#playerKit\s*\{[^}]*flex\s*:\s*1(?:\s+1\s+0%)?\s*;[^}]*min-height\s*:\s*0/);
    expect(compact).toMatch(/#player\.is-presenter-timeline\s+\.nli-presenter\s*\{[^}]*min-height\s*:\s*0/);
    expect(compactPortrait).toMatch(/\.nli-presenter\s*\{[^}]*min-height\s*:\s*0/);
    expect(compactPortrait).toMatch(/\.nli-presenter-browser\s*\{[^}]*min-height\s*:\s*0/);
    expect(compact).toMatch(/\.nli-presenter-list\s+button\s*\{[^}]*flex-direction\s*:\s*column/);
    expect(compactPortrait).toMatch(/\.nli-presenter-list\s+button\s*\{[^}]*flex-direction\s*:\s*column/);
    expect(compact).toMatch(/\.nli-presenter-list\s+button\s*>\s*bdi\s*\{[^}]*width\s*:\s*auto/);
    expect(compactPortrait).toMatch(/\.nli-presenter-list\s+button\s*>\s*bdi\s*\{[^}]*width\s*:\s*auto/);
    expect(compact).toMatch(/\.nli-presenter-list\s+button\s*>\s*span\s*\{[^}]*min-height\s*:\s*4\.2em/);
    expect(compactPortrait).toMatch(/\.nli-presenter-list\s+button\s*>\s*span\s*\{[^}]*min-height\s*:\s*4\.2em/);
  });
});
