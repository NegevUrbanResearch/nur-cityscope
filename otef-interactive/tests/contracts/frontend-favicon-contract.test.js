import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const frontendDirectory = path.resolve(import.meta.dirname, "../../frontend");
const viteConfig = fs.readFileSync(path.resolve(frontendDirectory, "../vite.config.mjs"), "utf8");

describe("frontend favicon contract", () => {
  it("declares a resolvable local favicon for every Vite HTML entry", () => {
    const entryNames = [...viteConfig.matchAll(/path\.resolve\(rootDir, "frontend\/([^\"]+\.html)"\)/g)]
      .map((match) => match[1]);

    expect(entryNames).toHaveLength(9);

    for (const entryName of entryNames) {
      const htmlPath = path.join(frontendDirectory, entryName);
      const html = fs.readFileSync(htmlPath, "utf8");
      const faviconHref = html.match(/<link\b(?=[^>]*\brel=["']icon["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1];

      expect(faviconHref, `${entryName} should declare a favicon`).toMatch(/^\.\/favicon\.ico(?:\?[^#]+)?$/);
      expect(path.resolve(path.dirname(htmlPath), faviconHref.split("?")[0])).toBe(
        path.join(frontendDirectory, "favicon.ico"),
      );
    }
  });

  it("scopes the staff web app to its remote page and uses the original 100px icon", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(frontendDirectory, "nli-staff.webmanifest"), "utf8"));
    expect(manifest.start_url).toBe("./nli-staff-remote.html");
    expect(manifest.scope).toBe("./nli-staff-remote.html");
    expect(manifest.display).toBe("fullscreen");
    expect(manifest.display_override).toContain("browser");
    expect(manifest.icons).toEqual([{
      src: "./nli-staff-icon.webp",
      sizes: "100x100",
      type: "image/webp",
      purpose: "any",
    }]);
    expect(fs.statSync(path.join(frontendDirectory, "nli-staff-icon.webp")).size).toBeGreaterThan(0);
  });
});
