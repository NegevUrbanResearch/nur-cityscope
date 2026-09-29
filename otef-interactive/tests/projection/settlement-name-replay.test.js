import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  applyReplayViteConfig,
  handleReplayApi,
  handleReplayUpgrade,
} from "../../scripts/settlement-name-baseline/replay-vite.config.mjs";
import {
  buildReplayEvidenceFiles,
  compareSettlementReplayLabel,
  createSettlementNameReplaySession,
  settlementRasterParity,
  sha256Hex,
} from "../../scripts/settlement-name-baseline/replay-entry.js";

test("clears an inherited proxy and rejects api writes and exhibit upgrades", async () => {
  const config = applyReplayViteConfig({
    server: { proxy: { "/api": "http://127.0.0.1:9", "/ws": "ws://127.0.0.1:9" } },
    build: { rollupOptions: { input: { projection: "frontend/projection.html" } } },
  });
  expect(config.server.proxy).toEqual({});
  expect(config.build.rollupOptions.input.projection).toBe("frontend/projection.html");
  expect(config.build.rollupOptions.input["settlement-name-replay"]).toBeUndefined();

  const writes = [];
  const res = {
    statusCode: 0,
    end(body) { writes.push({ status: this.statusCode, body }); },
    setHeader() {},
  };
  await handleReplayApi({ method: "POST", url: "/api/otef_viewport/by-table/otef/" }, res, { root: "missing" });
  expect(writes.at(-1).status).toBe(405);

  await handleReplayApi({ method: "GET", url: "/api/otef/unknown/" }, res, { root: "missing" });
  expect(writes.at(-1).status).toBe(404);

  let destroyed = false;
  handleReplayUpgrade({ url: "/ws/otef/" }, { destroy() { destroyed = true; } });
  expect(destroyed).toBe(true);
  let hmrDestroyed = false;
  handleReplayUpgrade({ url: "/@vite/client" }, { destroy() { hmrDestroyed = true; } });
  expect(hmrDestroyed).toBe(false);
});

test("serves captured framing bytes that match the baseline digest", async () => {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
  const framingPath = "projection-calibration/td-source-config.json";
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, "projection-calibration/td-baselines/manifest.json"), "utf8"));
  const disk = fs.readFileSync(path.join(publicDir, framingPath));
  const writes = [];
  const res = {
    statusCode: 0,
    end(body) { writes.push({ status: this.statusCode, body }); },
    setHeader() {},
  };
  const handled = await handleReplayApi({
    method: "GET",
    url: `/otef-interactive/public/${framingPath}`,
  }, res, { publicDir });
  expect(handled).toBe(true);
  expect(writes).toHaveLength(1);
  expect(writes[0].status).toBe(200);
  expect(Buffer.isBuffer(writes[0].body)).toBe(true);
  expect(writes[0].body.equals(disk)).toBe(true);
  expect(writes[0].body[0]).not.toBe(0xef);
  expect(writes[0].body.subarray(0, 1).toString()).not.toBe("<");
  expect(crypto.createHash("sha256").update(writes[0].body).digest("hex")).toBe(manifest.framing.sha256);
});

test("missing old ink is not a pass when the new label has ink", () => {
  const missingOld = compareSettlementReplayLabel({
    oldInk: null,
    newInk: { center: { x: 10, y: 20 }, width: 12, height: 30 },
    outputErrorPx: null,
  });
  expect(missingOld.passed).toBe(false);
  expect(missingOld.centerErrorPx).not.toBe(0);
  expect(missingOld.inkErrorPx).not.toBe(0);

  const missingNew = compareSettlementReplayLabel({
    oldInk: { center: { x: 10, y: 20 }, width: 12, height: 30 },
    newInk: null,
    outputErrorPx: null,
  });
  expect(missingNew.passed).toBe(false);
  expect(missingNew.centerErrorPx).not.toBe(0);
});

test("output error above one reference pixel fails inside the source-center budget", () => {
  const result = compareSettlementReplayLabel({
    oldInk: { center: { x: 100, y: 200 }, width: 16, height: 80 },
    newInk: { center: { x: 100.5, y: 200.5 }, width: 17, height: 79 },
    outputErrorPx: 1.109301406452911,
  });
  expect(result.centerErrorPx).toBeLessThanOrEqual(1);
  expect(result.inkErrorPx).toBeLessThanOrEqual(1);
  expect(result.outputErrorPx).toBeGreaterThan(1);
  expect(result.passed).toBe(false);
});

test("a blank old raster does not pass when the new raster has ink", () => {
  expect(settlementRasterParity({ oldInkCount: 0, newInkCount: 12 }).passed).toBe(false);
  expect(settlementRasterParity({ oldInkCount: 12, newInkCount: 0 }).passed).toBe(false);
  expect(settlementRasterParity({ oldInkCount: 12, newInkCount: 12 }).passed).toBe(true);
});

test("the exporter hashes cameras and the converted baseline into the parity payload", async () => {
  const evidence = {
    cameras: { left: { zoom: 11.45 }, right: { zoom: 11.45 } },
    converted: { captureId: "capture", outputs: { left: { "0067": { x: 1, y: 2 } } } },
    parityBody: { passed: false, captureId: "capture", maxCenterErrorPx: 1.2, maxOutputErrorPx: 1.109, labels: [] },
  };
  const files = await buildReplayEvidenceFiles(evidence);
  const parity = JSON.parse(files["parity.json"]);
  expect(parity.cameras).toEqual(evidence.cameras);
  expect(parity.convertedBaselineSha256).toBe(await sha256Hex(files["converted-baseline.json"]));
  const { payloadSha256, ...payload } = parity;
  expect(payloadSha256).toBe(await sha256Hex(`${JSON.stringify(payload)}\n`));
});

test("page close disposes replay maps and renderers", () => {
  const disposed = [];
  const session = createSettlementNameReplaySession({
    maps: [{ remove() { disposed.push("map"); } }],
    renderers: [{ dispose() { disposed.push("renderer"); } }],
  });
  session.dispose();
  expect(disposed).toEqual(["map", "renderer"]);
  session.dispose();
  expect(disposed).toEqual(["map", "renderer"]);
});
