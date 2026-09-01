import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(
  testDirectory,
  "../../scripts/configure-chrome-popup-policy.ps1",
);

describe("Chrome popup policy setup script", () => {
  const readScript = () => fs.readFileSync(scriptPath, "utf8");

  test("targets only the localhost exhibit origin and the popup allowlist policy", () => {
    const source = readScript();

    expect(source).toContain("HKLM:\\Software\\Policies\\Google\\Chrome\\PopupsAllowedForUrls");
    expect(source).toContain("$AllowedOrigin = 'http://localhost:80'");
    expect(source).not.toContain("$AllowedOrigin = '*'");
    expect(source).not.toContain("DefaultPopupsSetting");
  });

  test("offers idempotent install, remove, and status modes", () => {
    const source = readScript();

    expect(source).toContain("ValidateSet('Install', 'Remove', 'Status')");
    expect(source).toContain("$Mode = 'Status'");
    expect(source).toContain("already configured");
    expect(source).toContain("New-ItemProperty");
    expect(source).toContain("-PropertyType String");
    expect(source).toContain("-Name $slot");
    expect(source).not.toContain("New-ItemProperty -Force");
  });

  test("accepts an empty policy list on first installation", () => {
    const source = readScript();

    expect(source).toContain("[AllowEmptyCollection()]");
  });

  test("requires elevation for changes and removes only the exact origin", () => {
    const source = readScript();

    expect(source).toContain("WindowsPrincipal");
    expect(source).toContain("Assert-Administrator");
    expect(source).toContain("$entry.Value -eq $AllowedOrigin");
    expect(source).toContain("Remove-ItemProperty");
    expect(source).toContain("-Name $entry.Name");
  });
});
