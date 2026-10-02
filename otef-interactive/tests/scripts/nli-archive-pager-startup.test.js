import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptsDirectory = path.resolve(testDirectory, "../../scripts");

function readScript(name) {
  return fs.readFileSync(path.join(scriptsDirectory, name), "utf8");
}

describe("NLI archive pager startup", () => {
  test("start-otef.ps1 starts the pager after share hosts and warns in degraded mode", () => {
    const source = readScript("start-otef.ps1");
    const shareAt = source.indexOf("write-share-hosts.mjs");
    const pagerAt = source.indexOf("nli-archive-pager.mjs");

    expect(shareAt).toBeGreaterThanOrEqual(0);
    expect(pagerAt).toBeGreaterThan(shareAt);
    expect(source).toContain("Join-Path $PSScriptRoot 'nli-archive-pager.mjs'");
    expect(source).toContain("Start-Process -WindowStyle Hidden node -ArgumentList @($pagerPath)");
    expect(source).toContain("127.0.0.1");
    expect(source).toContain("7733");

    const afterPager = source.slice(pagerAt);
    expect(afterPager).toContain("degraded-mode");
    expect(afterPager).toContain("try");
    expect(afterPager).not.toContain("return $false");
    expect(source).toContain("gis-chrome-profile");
    expect(source).toContain("remote-debugging-port=9222");
    expect(source).toContain(
      '$gisUrl = "$origin/otef-interactive/index.html?archivePager=1"',
    );
    expect(source).toMatch(/& \$BrowserLauncher \$gisUrl/);
    expect(source).not.toContain(
      '$launcherUrl = "$origin/otef-interactive/launcher.html?archivePager=1"',
    );
    const browserLauncher = source.slice(
      source.indexOf("if ($null -eq $BrowserLauncher)"),
      source.indexOf("& $BrowserLauncher $gisUrl"),
    );
    expect(browserLauncher).not.toContain("Start-Process $url");
  });

  test("start-otef.sh starts the pager after share hosts without failing set -e", () => {
    const source = readScript("start-otef.sh");
    expect(source).toContain("set -euo pipefail");

    const shareAt = source.indexOf("write-share-hosts.mjs");
    const afterShare = source.slice(shareAt);
    const relaxAt = afterShare.indexOf("set +e");
    const pagerAt = afterShare.indexOf('node "$SCRIPT_DIR/nli-archive-pager.mjs" >/dev/null 2>&1 &');
    const restoreAt = afterShare.indexOf("\nset -e\n", pagerAt);

    expect(shareAt).toBeGreaterThanOrEqual(0);
    expect(relaxAt).toBeGreaterThanOrEqual(0);
    expect(relaxAt).toBeLessThan(pagerAt);
    expect(restoreAt).toBeGreaterThan(pagerAt);
    expect(afterShare.slice(pagerAt)).toContain("degraded-mode");
    expect(afterShare).toContain("127.0.0.1");
    expect(afterShare).toContain("7733");
  });
});
