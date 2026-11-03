import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const scriptUrl = new URL("../../scripts/write-frontend-version.mjs", import.meta.url);

async function withFrontendRoot(run) {
  const frontendRoot = await mkdtemp(path.join(os.tmpdir(), "frontend-version-"));
  try {
    await mkdir(path.join(frontendRoot, "src"), { recursive: true });
    await mkdir(path.join(frontendRoot, "css"), { recursive: true });
    await mkdir(path.join(frontendRoot, "runtime"), { recursive: true });
    await mkdir(path.join(frontendRoot, "dist"), { recursive: true });
    await writeFile(path.join(frontendRoot, "src", "b.js"), "b");
    await writeFile(path.join(frontendRoot, "src", "a.js"), "a");
    await writeFile(path.join(frontendRoot, "css", "app.css"), "css");
    await writeFile(path.join(frontendRoot, "index.html"), "html");
    await writeFile(path.join(frontendRoot, "nli-staff.webmanifest"), "manifest");
    return await run(frontendRoot);
  } finally {
    await rm(frontendRoot, { recursive: true, force: true });
  }
}

async function publish(frontendRoot) {
  const { writeFrontendVersion } = await import(scriptUrl);
  return writeFrontendVersion({ frontendRoot });
}

describe("frontend build version publisher", () => {
  test("hashes sorted deployed paths and bytes deterministically", async () => {
    let initialBuildId;
    await withFrontendRoot(async (frontendRoot) => {
      const first = await publish(frontendRoot);
      const second = await publish(frontendRoot);
      initialBuildId = first.buildId;
      expect(first).toEqual(second);
      expect(first.buildId).toMatch(/^frontend-[a-f0-9]{16}$/);
      expect(await readFile(first.outputPath, "utf8")).toContain(
        `export const FRONTEND_BUILD_ID = "${first.buildId}";`,
      );
    });
    await withFrontendRoot(async (frontendRoot) => {
      const reversed = ["index.html", "css/app.css", "src/a.js", "src/b.js", "nli-staff.webmanifest"];
      for (const relativePath of reversed) {
        await rm(path.join(frontendRoot, relativePath), { force: true });
      }
      for (const relativePath of reversed) {
        await mkdir(path.dirname(path.join(frontendRoot, relativePath)), { recursive: true });
        const contents = {
          "index.html": "html",
          "css/app.css": "css",
          "src/a.js": "a",
          "src/b.js": "b",
          "nli-staff.webmanifest": "manifest",
        }[relativePath];
        await writeFile(path.join(frontendRoot, relativePath), contents);
      }
      expect((await publish(frontendRoot)).buildId).toBe(initialBuildId);
    });
  });

  test("changes when deployed source bytes change", async () => {
    await withFrontendRoot(async (frontendRoot) => {
      const before = await publish(frontendRoot);
      await writeFile(path.join(frontendRoot, "src", "a.js"), "changed");
      const after = await publish(frontendRoot);
      expect(after.buildId).not.toBe(before.buildId);
    });
  });

  test("ignores runtime, dist, processed data, and timestamps", async () => {
    await withFrontendRoot(async (frontendRoot) => {
      const before = await publish(frontendRoot);
      await writeFile(path.join(frontendRoot, "runtime", "share.json"), "runtime");
      await writeFile(path.join(frontendRoot, "dist", "bundle.js"), "dist");
      await mkdir(path.join(frontendRoot, "processed", "layers"), { recursive: true });
      await writeFile(path.join(frontendRoot, "processed", "layers", "data.geojson"), "data");
      await utimes(path.join(frontendRoot, "src", "a.js"), new Date(1), new Date(1));
      const after = await publish(frontendRoot);
      expect(after.buildId).toBe(before.buildId);
    });
  });
});
