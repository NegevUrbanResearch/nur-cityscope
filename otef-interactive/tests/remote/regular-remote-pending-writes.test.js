import { afterEach, expect, test, vi } from "vitest";
import { OTEF_API } from "../../frontend/src/shared/api-client.js";
afterEach(() => vi.unstubAllGlobals());
test.each(["updateState", "executeCommand"])("%s tracks through response decoding and releases on failure", async method => {
  let finish;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: () => new Promise(resolve => { finish = resolve; }) })));
  const operation = OTEF_API[method]("otef", {});
  expect(OTEF_API.hasPendingWrites("otef")).toBe(true);
  expect(OTEF_API.hasPendingWrites("other")).toBe(false);
  await Promise.resolve(); finish({}); await operation;
  expect(OTEF_API.hasPendingWrites("otef")).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("offline"); }));
  await expect(OTEF_API[method]("otef", {})).rejects.toThrow("offline");
  expect(OTEF_API.hasPendingWrites("otef")).toBe(false);
});
test("queued viewport work blocks refresh before HTTP begins", () => {
  OTEF_API._viewportDebounces.set("otef", {});
  expect(OTEF_API.hasPendingWrites("otef")).toBe(true);
  OTEF_API._viewportDebounces.delete("otef");
  OTEF_API._viewportImmediateQueues.set("otef", { inFlight: false, pending: [{}] });
  expect(OTEF_API.hasPendingWrites("otef")).toBe(true);
  OTEF_API._viewportImmediateQueues.delete("otef");
  expect(OTEF_API.hasPendingWrites("otef")).toBe(false);
});
