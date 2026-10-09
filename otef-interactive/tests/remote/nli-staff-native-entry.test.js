import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { build } from "vite";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend",
);
const staffHtml = path.join(frontendRoot, "nli-staff-remote.html");

function servedModuleChain() {
  const html = readFileSync(staffHtml, "utf8");
  const script = html.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  if (!script) throw new Error("Staff HTML has no module entry script");
  const entryUrl = new URL(script[1], pathToFileURL(staffHtml));
  const entryPath = fileURLToPath(entryUrl);
  const entry = readFileSync(entryPath, "utf8");
  const staffImport = entry.match(/import\s*\{\s*initNliStaffRemote\s*\}\s*from\s*["']([^"']+)["']/);
  if (!staffImport) throw new Error("Staff module entry does not import initNliStaffRemote");
  return {
    entryPath,
    entryUrl: entryUrl.href,
    staffUrl: new URL(staffImport[1], entryUrl).href,
  };
}

describe("native staff remote module graph", () => {
  test("consumes refresh receipts before starting ordinary staff Home initialization", () => {
    const { entryPath } = servedModuleChain();
    const entry = readFileSync(entryPath, "utf8");
    const management = entry.indexOf("createStaffRemoteManagement({");
    const initializerMatch = entry.match(/staffRemote\s*=\s*initNliStaffRemote\(\s*OTEFDataContext\s*,/);
    const initializer = initializerMatch?.index ?? -1;
    expect(management).toBeGreaterThanOrEqual(0);
    expect(initializerMatch).not.toBeNull();
    expect(initializer).toBeGreaterThan(management);
    expect(entry).toContain("readCanonicalState: async ({ signal })");
    expect(entry).toContain('cache: "no-store"');
    expect(entry).toContain("onHomeSuccess: () => management.noteHomeSuccess()");
    expect(entry.indexOf("if (!response.ok)")).toBeLessThan(entry.indexOf("return response.json()"));
  });

  test("loads the served HTML entry and its staff module graph under native ESM", () => {
    const { entryPath, entryUrl, staffUrl } = servedModuleChain();
    const entryCheck = spawnSync(process.execPath, ["--check", entryPath], { encoding: "utf8" });
    expect(entryCheck.status, entryCheck.stderr || entryCheck.error?.message).toBe(0);

    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "await import(process.argv[1]); await import(process.argv[2])",
        entryUrl,
        staffUrl,
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(result.stderr).not.toContain("ERR_IMPORT_ATTRIBUTE_MISSING");
  });

  test("imports one frontend build ID in native ESM and includes it in the Vite bundle", async () => {
    const { entryUrl } = servedModuleChain();
    const nativeCheck = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", "const entry=await import(process.argv[1]); console.log(entry.FRONTEND_BUILD_ID)", entryUrl],
      { encoding: "utf8" },
    );
    expect(nativeCheck.status, nativeCheck.stderr || nativeCheck.error?.message).toBe(0);
    const buildId = nativeCheck.stdout.trim().split(/\r?\n/).at(-1);
    expect(buildId).toMatch(/^frontend-[a-f0-9]{16}$/);

    const output = await build({
      configFile: path.resolve(frontendRoot, "../vite.config.mjs"),
      write: false,
      logLevel: "silent",
    });
    const bundleSource = output.output
      .filter((asset) => asset.type === "chunk")
      .map((chunk) => chunk.code)
      .join("\n");
    expect(bundleSource.includes(buildId)).toBe(true);
  }, 30_000);
});
