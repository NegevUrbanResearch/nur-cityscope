import { afterEach, describe, expect, test, vi } from "vitest";

const helpers = () => import("../../frontend/src/remote/nli-staff-experience.js");
const home = { scriptId: null, step: 0, returnTo: null };
const scene = { scriptId: "segev", step: 0, returnTo: null };

afterEach(() => vi.useRealTimers());

describe("NLI experience bookmark", () => {
  test("validates authored scenes and rejects junctions or stale script references", async () => {
    const { normalizeNliBookmark } = await helpers();
    expect(normalizeNliBookmark(scene)).toEqual(scene);
    expect(normalizeNliBookmark(home)).toEqual(home);
    expect(normalizeNliBookmark({ scriptId: "missing", step: 0 })).toBeNull();
    expect(normalizeNliBookmark({ scriptId: "segev", step: 99 })).toBeNull();
    expect(normalizeNliBookmark({ scriptId: "show", step: 4 })).toBeNull();
  });

  test("serializes bookmark writes and flush waits for the newest confirmation", async () => {
    const { createNliBookmarkPersistence } = await helpers();
    const sent = [], release = [];
    const dataContext = { saveNliBookmark: bookmark => { sent.push(bookmark); return new Promise(resolve => release.push(resolve)); } };
    const persistence = createNliBookmarkPersistence({ dataContext });
    persistence.hydrate(home);
    const first = persistence.save(scene);
    const second = persistence.save(home);
    let flushed = false;
    const flush = persistence.flush().then(() => { flushed = true; });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(persistence.get()).toEqual(home);
    release.shift()({ ok: true });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(flushed).toBe(false);
    release.shift()({ ok: true });
    await Promise.all([first, second, flush]);
    expect(persistence.get()).toEqual(home);
    expect(flushed).toBe(true);
  });

  test("failed persistence does not become a confirmed bookmark or successful flush", async () => {
    const { createNliBookmarkPersistence } = await helpers();
    const failure = new Error("offline");
    const persistence = createNliBookmarkPersistence({ dataContext: { saveNliBookmark: async () => { throw failure; } } });
    persistence.hydrate(home);
    await expect(persistence.save(scene)).rejects.toBe(failure);
    await expect(persistence.flush()).rejects.toBe(failure);
    expect(persistence.get()).toEqual(home);
  });

  test("never rebinds queued old bookmarks to a new activation", async () => {
    const { createNliBookmarkPersistence } = await helpers();
    let revision = 2, release;
    const sent = [];
    const dataContext = {
      captureExperienceScope: () => ({ experience: "nli", experience_revision: revision }),
      isExperienceScopeCurrent: scope => scope.experience_revision === revision,
      saveNliBookmark: bookmark => { sent.push(bookmark); return new Promise(resolve => { release = resolve; }); },
    };
    const persistence = createNliBookmarkPersistence({ dataContext });
    const first = persistence.save(scene);
    const queued = persistence.save(home);
    const outcomes = Promise.allSettled([first, queued]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    revision = 3;
    release({ ok: true });
    expect((await outcomes).every(result => result.status === "rejected")).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

describe("NLI archive switch cleanup", () => {
  test("waits for correlated GIS closure rather than dispatch acknowledgement", async () => {
    const { closeNliArchiveForExperienceSwitch } = await helpers();
    let phase = "open", listener;
    const context = { subscribe: (_topic, handler) => { listener = handler; return () => {}; } };
    const archive = { getArchivePhase: () => phase, closeArchive: async () => { phase = "closing"; return true; } };
    let settled = false;
    const closed = closeNliArchiveForExperienceSwitch(archive, context).then(result => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    listener({ outcome: "closed", requestId: "other" });
    expect(settled).toBe(false);
    phase = "closed";
    listener({ outcome: "closed", requestId: "current" });
    await expect(closed).resolves.toBe(true);
  });

  test("unavailable and missing close replies do not claim successful cleanup", async () => {
    vi.useFakeTimers();
    const { closeNliArchiveForExperienceSwitch } = await helpers();
    let listener;
    const context = { subscribe: (_topic, handler) => { listener = handler; return () => {}; } };
    const archive = { getArchivePhase: () => "open", closeArchive: async () => true };
    const closed = closeNliArchiveForExperienceSwitch(archive, context, { timeoutMs: 30 });
    listener({ outcome: "unavailable" });
    await vi.advanceTimersByTimeAsync(30);
    await expect(closed).resolves.toBe(false);
  });

  test("waits for an opening archive before sending one close", async () => {
    const { closeNliArchiveForExperienceSwitch } = await helpers();
    let phase = "opening", listener, closes = 0;
    const context = { subscribe: (_topic, handler) => { listener = handler; return () => {}; } };
    const archive = { getArchivePhase: () => phase, closeArchive: async () => { closes += 1; phase = "closing"; return true; } };
    const closed = closeNliArchiveForExperienceSwitch(archive, context);
    phase = "open";
    listener({ outcome: "opened" });
    listener({ outcome: "opened" });
    expect(closes).toBe(1);
    phase = "closed";
    listener({ outcome: "closed" });
    await expect(closed).resolves.toBe(true);
  });
});
