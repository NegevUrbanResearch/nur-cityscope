import { describe, expect, test, vi } from "vitest";
import { loadShareOrigin, resolveShareOrigin } from "../../frontend/src/shared/share-origin.js";

const runtime = (overrides = {}) => ({
  version: 1,
  remoteOrigin: "http://192.0.2.10:8500",
  generatedAt: "2026-09-13T10:00:00.000Z",
  status: "ready",
  ...overrides,
});

describe("resolveShareOrigin", () => {
  test("network page preserves scheme and port", () => {
    expect(resolveShareOrigin(new URL("https://exhibit.example:8443/otef-interactive/"), null))
      .toBe("https://exhibit.example:8443");
  });

  test("loopback never becomes phone URL", () => {
    expect(resolveShareOrigin(new URL("http://127.0.0.2:8500/"), null)).toBeNull();
    expect(resolveShareOrigin(new URL("http://[::1]:8500/"), null)).toBeNull();
    expect(resolveShareOrigin(new URL("http://localhost.:8500/"), null)).toBeNull();
    expect(resolveShareOrigin(new URL("http://[::ffff:127.0.0.1]:8500/"), null)).toBeNull();
  });

  test("accepts only fresh host generated runtime metadata", () => {
    const location = new URL("http://localhost:8500/otef-interactive/launcher.html");
    const now = Date.parse("2026-09-13T10:00:30.000Z");
    expect(resolveShareOrigin(location, runtime({ generatedAt: new Date(now).toISOString() }))).toBe(
      "http://192.0.2.10:8500",
    );
    expect(resolveShareOrigin(location, runtime({ generatedAt: "2026-09-13T09:58:00.000Z" }))).toBe(
      "http://192.0.2.10:8500",
    );
  });

  test("rejects credentials, paths, invalid schema and virtual address metadata", () => {
    const location = new URL("http://localhost:8500/");
    const now = Date.parse("2026-09-13T10:00:00.000Z");
    expect(resolveShareOrigin(location, runtime({ remoteOrigin: "http://user:pass@192.0.2.10:8500" }))).toBeNull();
    expect(resolveShareOrigin(location, runtime({ remoteOrigin: "http://192.0.2.10:8500/path" }))).toBeNull();
    expect(resolveShareOrigin(location, runtime({ remoteOrigin: "http://localhost.:8500" }))).toBeNull();
    expect(resolveShareOrigin(location, runtime({ remoteOrigin: "http://[::ffff:127.0.0.1]:8500" }))).toBeNull();
    expect(resolveShareOrigin(location, runtime({ version: 2 }))).toBeNull();
    expect(resolveShareOrigin(location, runtime({ adapter: { virtual: true } }))).toBeNull();
    expect(resolveShareOrigin(location, runtime({ generatedAt: undefined }))).toBeNull();
    expect(resolveShareOrigin(location, runtime({ generatedAt: new Date(now).toISOString(), status: "unavailable" }))).toBeNull();
  });
});

test("loadShareOrigin fetches loopback runtime without cache and catches failures", async () => {
  const location = new URL("http://localhost:8500/otef-interactive/launcher.html");
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(runtime({ generatedAt: "2026-09-13T10:00:00.000Z" })) });
  expect(await loadShareOrigin({ location, fetchImpl, now: () => Date.parse("2026-09-13T10:00:00.000Z") })).toBe(
    "http://192.0.2.10:8500",
  );
  expect(fetchImpl).toHaveBeenCalledWith("/otef-interactive/runtime/network.json", { cache: "no-store" });
  fetchImpl.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(runtime({ generatedAt: "2026-09-13T09:58:00.000Z" })) });
  expect(await loadShareOrigin({ location, fetchImpl, now: () => Date.parse("2026-09-13T10:00:00.000Z") })).toBeNull();
  fetchImpl.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(runtime({ generatedAt: "2026-09-13T10:01:00.000Z" })) });
  expect(await loadShareOrigin({ location, fetchImpl, now: () => Date.parse("2026-09-13T10:00:00.000Z") })).toBeNull();
  const failing = vi.fn().mockRejectedValue(new Error("offline"));
  expect(await loadShareOrigin({ location, fetchImpl: failing })).toBeNull();
});
