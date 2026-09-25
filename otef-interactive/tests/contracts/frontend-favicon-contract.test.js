import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const frontendDirectory = path.resolve(import.meta.dirname, "../../frontend");
const viteConfig = fs.readFileSync(path.resolve(frontendDirectory, "../vite.config.mjs"), "utf8");

describe("frontend favicon contract", () => {
  it("declares a resolvable local favicon for every Vite HTML entry", () => {
    const entryNames = [...viteConfig.matchAll(/path\.resolve\(rootDir, "frontend\/([^\"]+\.html)"\)/g)]
      .map((match) => match[1]);

    expect(entryNames).toHaveLength(8);

    for (const entryName of entryNames) {
      const htmlPath = path.join(frontendDirectory, entryName);
      const html = fs.readFileSync(htmlPath, "utf8");
      const faviconHref = html.match(/<link\b(?=[^>]*\brel=["']icon["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1];

      expect(faviconHref, `${entryName} should declare a favicon`).toBe("./favicon.ico");
      expect(path.resolve(path.dirname(htmlPath), faviconHref)).toBe(
        path.join(frontendDirectory, "favicon.ico"),
      );
    }
  });
});
