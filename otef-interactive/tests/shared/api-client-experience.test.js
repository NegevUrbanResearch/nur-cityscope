import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let api;
const reply = (value = {}) => ({ ok: true, status: 200, json: async () => value });
const bodyAt = (index) => JSON.parse(globalThis.fetch.mock.calls[index][1].body);
const camera = (zoom) => ({ bbox: [1, 2, 3, 4], zoom });

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(async () => reply()));
  ({ OTEF_API: api } = await import("../../frontend/src/shared/api-client.js"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("experience-scoped API writes", () => {
  test("keeps a bound NLI command NLI-scoped while regular is active", async () => {
    api.setExperienceScope("otef", () => ({ experience: "nli", experience_revision: 7 }));
    await api.updateState("otef", { animations: {} });
    await api.executeCommand("otef", { action: "set_narrative", narrativeId: null });
    expect(bodyAt(0)).toMatchObject({ experience: "nli", experience_revision: 7 });
    expect(bodyAt(1)).toMatchObject({ experience: "nli", experience_revision: 7 });
  });

  test("copies installed scopes and preserves an explicit older command scope", async () => {
    const scope = { experience: "regular", experience_revision: 4 };
    api.setExperienceScope("otef", scope);
    scope.experience_revision = 99;
    await api.updateState("otef", { basemap: "dark" });
    await api.setNarrative("otef", null, 3, { experience: "nli", experience_revision: 2 });
    expect(bodyAt(0)).toMatchObject({ experience: "regular", experience_revision: 4 });
    expect(bodyAt(1)).toMatchObject({ experience: "nli", experience_revision: 2 });
  });

  test("retains HTTP status and experience conflict details for PATCH errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ reason: "stale_experience", experience_state: { active_experience: "nli", revision: 8 } }) });
    await expect(api.updateState("otef", { basemap: "dark" })).rejects.toMatchObject({
      status: 409, details: { reason: "stale_experience", experience_state: { revision: 8 } },
    });
  });

  test("captures debounce scope and camera before activation or caller mutation", async () => {
    vi.useFakeTimers();
    let scope = { experience: "regular", experience_revision: 4 };
    api.setExperienceScope("otef", () => scope);
    const viewport = camera(13);
    api.updateViewportDebounced("otef", viewport);
    scope = { experience: "nli", experience_revision: 5 };
    viewport.zoom = 19;
    await vi.advanceTimersByTimeAsync(120);
    expect(bodyAt(0)).toMatchObject({ viewport: { zoom: 13 }, experience: "regular", experience_revision: 4 });
  });

  test("queued immediate writes keep their creation scope after activation", async () => {
    const releases = [];
    globalThis.fetch.mockImplementation(() => new Promise(resolve => releases.push(resolve)));
    let scope = { experience: "regular", experience_revision: 4 };
    api.setExperienceScope("otef", () => scope);
    const first = api.updateViewportImmediate("otef", camera(12));
    const pending = api.updateViewportImmediate("otef", camera(13));
    scope = { experience: "nli", experience_revision: 5 };
    releases.shift()(reply());
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    expect(bodyAt(1)).toMatchObject({ viewport: { zoom: 13 }, experience: "regular", experience_revision: 4 });
    releases.shift()(reply());
    await Promise.all([first, pending]);
  });

  test("does not attach old activation callers to a new activation camera acknowledgement", async () => {
    const releases = [];
    globalThis.fetch.mockImplementation(() => new Promise(resolve => releases.push(resolve)));
    api.setExperienceScope("otef", { experience: "regular", experience_revision: 4 });
    const first = api.updateViewportImmediate("otef", camera(12));
    const old = api.updateViewportImmediate("otef", camera(13));
    api.setExperienceScope("otef", { experience: "nli", experience_revision: 5 });
    const current = api.updateViewportImmediate("otef", camera(14));
    releases.shift()(reply({ step: "first" }));
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    expect(bodyAt(1)).toMatchObject({ viewport: { zoom: 13 }, experience_revision: 4 });
    releases.shift()(reply({ step: "old" }));
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    expect(bodyAt(2)).toMatchObject({ viewport: { zoom: 14 }, experience_revision: 5 });
    releases.shift()(reply({ step: "current" }));
    await expect(Promise.all([first, old, current])).resolves.toEqual([{ step: "first" }, { step: "old" }, { step: "current" }]);
  });

  test("uses independent scope and debounce timers for different tables", async () => {
    vi.useFakeTimers();
    api.setExperienceScope("one", { experience: "regular", experience_revision: 2 });
    api.setExperienceScope("two", { experience: "nli", experience_revision: 9 });
    api.updateViewportDebounced("one", camera(12));
    api.updateViewportDebounced("two", camera(15));
    await vi.advanceTimersByTimeAsync(120);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(bodyAt(0)).toMatchObject({ experience: "regular", experience_revision: 2 });
    expect(bodyAt(1)).toMatchObject({ experience: "nli", experience_revision: 9 });
  });

  test("promotes explicit viewport metadata without replacing it from the provider", async () => {
    api.setExperienceScope("otef", { experience: "nli", experience_revision: 9 });
    await api.updateViewportImmediate("otef", { ...camera(12), experience: "regular", experience_revision: 8 });
    expect(bodyAt(0)).toMatchObject({ experience: "regular", experience_revision: 8 });
  });

  test("a camera queued before hydration cannot inherit the first activated revision", async () => {
    vi.useFakeTimers();
    api.updateViewportDebounced("otef", camera(12));
    api.setExperienceScope("otef", { experience: "nli", experience_revision: 1 });
    await vi.advanceTimersByTimeAsync(120);
    expect(bodyAt(0)).toMatchObject({ experience: "regular", experience_revision: 0 });
  });

  test("forwards explicit scope through settings wrappers that select metadata fields", async () => {
    api.setExperienceScope("otef", { experience: "nli", experience_revision: 9 });
    const old = { experience: "regular", experience_revision: 8 };
    await api.setRoadSigns("otef", {}, old);
    await api.setSettlementNames("otef", { operation: "replace" }, old);
    expect(bodyAt(0)).toMatchObject(old);
    expect(bodyAt(1)).toMatchObject(old);
  });
});
