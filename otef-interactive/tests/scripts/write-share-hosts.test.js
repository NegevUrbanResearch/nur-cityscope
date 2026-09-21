import { expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeShareHosts } from "../../scripts/write-share-hosts.mjs";

test("writeShareHosts records hostname.local and optional tailnet IP", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "otef-share-"));
  const runtimePath = path.join(directory, "runtime", "share.json");
  try {
    await writeShareHosts({ runtimePath, hostname: "labpc", port: 80, tailnetIp: "100.64.252.114" });
    expect(JSON.parse(await readFile(runtimePath, "utf8"))).toEqual({
      localOrigin: "http://labpc.local",
      tailnetOrigin: "http://100.64.252.114",
    });
    await writeShareHosts({ runtimePath, hostname: "Noams-MacBook-Pro.local", port: 8512, tailnetIp: null });
    expect(JSON.parse(await readFile(runtimePath, "utf8"))).toEqual({
      localOrigin: "http://noams-macbook-pro.local:8512",
      tailnetOrigin: null,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
