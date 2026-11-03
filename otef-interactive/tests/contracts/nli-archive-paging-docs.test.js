import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const otefRoot = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(otefRoot, relativePath), "utf8");
}

describe("NLI archive paging docs contracts", () => {
  test("AGENTS.md documents dedicated GIS Chrome debug flags", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("user-data-dir");
    expect(agents).toContain("remote-debugging-address=127.0.0.1");
  });

  test("start-otef mentions the pager", () => {
    const ps1 = read("scripts/start-otef.ps1");
    const sh = read("scripts/start-otef.sh");
    expect(ps1).toContain("nli-archive-pager.mjs");
    expect(sh).toContain("nli-archive-pager.mjs");
  });
});
