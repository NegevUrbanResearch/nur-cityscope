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
    expect(source).toContain("HKLM:\\Software\\Policies\\Google\\Chrome\\AutoplayAllowlist");
    expect(source).toContain("http://localhost:80");
    expect(source).toMatch(/Install-Policy[^]*foreach[^]*\$Policies/);
    expect(source).toMatch(/Remove-Policy[^]*foreach[^]*\$Policies/);
    expect(source).toMatch(/Show-Status[^]*foreach[^]*\$Policies/);
  });

  test("installs the CrossOriginOpenerPolicy Chrome launch flag on existing shortcuts", () => {
    const source = readScript();

    expect(source).toContain("--disable-features=CrossOriginOpenerPolicy");
    expect(source).toContain("CrossOriginOpenerPolicy");
    expect(source).toContain("WScript.Shell");
    expect(source).toContain("Install-ChromeLaunchFlag");
    expect(source).toContain("Google Chrome.lnk");
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

  test("adds dedicated GIS debug flags even when COOP is already present", () => {
    const source = readScript();

    expect(source).toMatch(
      /\$ChromeUserDataDir\s*=\s*'--user-data-dir=%LOCALAPPDATA%\\OTEF\\gis-chrome-profile'/,
    );
    expect(source).toMatch(/\$ChromeDebugPort\s*=\s*'--remote-debugging-port=9222'/);
    expect(source).toMatch(/\$ChromeDebugAddress\s*=\s*'--remote-debugging-address=127\.0\.0\.1'/);
    expect(source).toContain("ValidateSet('Install', 'Remove', 'Status')");
    expect(source).toContain("OTEF GIS.lnk");
    expect(source).toContain("function Install-OtefGisShortcut");
    expect(source).toContain("Get-OtefGisLaunchArguments");

    const installFn = source.slice(
      source.indexOf("function Install-ChromeLaunchFlag"),
      source.indexOf("function Remove-ChromeLaunchFlag"),
    );
    expect(installFn).toContain("Install-OtefGisShortcut");
    expect(installFn).toContain("Remove-ChromeArgument");
    expect(installFn).toContain("$ChromeUserDataDir");
    expect(installFn).toContain("$ChromeDebugPort");
    expect(installFn).toContain("$ChromeDebugAddress");
    expect(installFn).not.toMatch(/Add-ChromeArgument -Arguments \$next -Argument \$ChromeUserDataDir/);

    const otefFn = source.slice(
      source.indexOf("function Install-OtefGisShortcut"),
      source.indexOf("function Install-ChromeLaunchFlag"),
    );
    expect(otefFn).toContain("Get-OtefGisLaunchArguments");
    expect(otefFn).toContain("OTEF GIS");
    expect(source).toContain(
      "$OtefGisUrl = 'http://localhost/otef-interactive/index.html?archivePager=1'",
    );

    const statusFn = source.slice(
      source.indexOf("function Show-LaunchFlagStatus"),
      source.indexOf("function Show-Status"),
    );
    expect(statusFn).toContain("$ChromeUserDataDir");
    expect(statusFn).toContain("$ChromeDebugPort");
    expect(statusFn).toContain("$ChromeDebugAddress");
    expect(statusFn).toContain("OTEF GIS");
  });

  test("does not add archive ownership or a dedicated profile to personal Chrome shortcuts", () => {
    const source = readScript();
    const installFn = source.slice(
      source.indexOf("function Install-ChromeLaunchFlag"),
      source.indexOf("function Remove-ChromeLaunchFlag"),
    );

    expect(installFn).not.toContain("$OtefGisUrl");
    expect(installFn).not.toContain("archivePager=1");
    expect(installFn).not.toMatch(/Add-ChromeArgument -Arguments \$next -Argument \$ChromeUserDataDir/);
  });

  test("remove undoes debug and profile arguments without deleting the profile folder", () => {
    const source = readScript();
    const removeFn = source.slice(
      source.indexOf("function Remove-ChromeLaunchFlag"),
      source.indexOf("function Show-LaunchFlagStatus"),
    );

    expect(removeFn).toContain("Remove-ChromeDisableFeature");
    expect(removeFn).toContain("Remove-ChromeArgument");
    expect(removeFn).toContain("$ChromeUserDataDir");
    expect(removeFn).toContain("$ChromeDebugPort");
    expect(removeFn).toContain("$ChromeDebugAddress");
    expect(removeFn).toContain("Get-OtefGisShortcutPath");
    expect(removeFn.toLowerCase()).toContain("not delete");
    expect(removeFn).not.toContain("Remove-Item");
    expect(source).not.toMatch(/Remove-Item[\s\S]{0,240}gis-chrome-profile/);
  });
});
