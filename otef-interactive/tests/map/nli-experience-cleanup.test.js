import { expect, test, vi } from "vitest";

const pending = () => ({ active_experience: "nli", revision: 2, pending_transition: { request_id: "exit-1", from_experience: "nli", target: "regular" } });
async function install(options = {}) {
  const { installNliExperienceCleanup } = await import("../../frontend/src/map/nli-experience-cleanup.js");
  let state = pending();
  const listeners = new Map();
  const context = {
    getExperienceState: () => state,
    reportExperienceCleanup: vi.fn(async () => ({ ok: true })),
    subscribe(topic, fn) { listeners.set(topic, fn); return () => listeners.delete(topic); },
  };
  const archiveWindow = { getHandle: () => null, close: vi.fn(() => ({ ok: false, reason: "silent" })) };
  const viewer = { closeForScene: vi.fn(), close: vi.fn(async () => {}), getSceneCommand: () => null };
  const dispose = installNliExperienceCleanup({ dataContext: context, archiveWindow, getPresentationViewer: () => viewer, ownsArchiveCommands: true, ...options });
  return { context, archiveWindow, viewer, dispose, emit(next = state) { state = next; listeners.get("experienceState")?.(state); } };
}

test("only acknowledges GIS cleanup after presentation closure actually completes", async () => {
  let release;
  const viewer = { closeForScene: vi.fn(), close: () => new Promise(resolve => { release = resolve; }), getSceneCommand: () => null };
  const h = await install({ getPresentationViewer: () => viewer });
  expect(h.context.reportExperienceCleanup).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(h.context.reportExperienceCleanup).toHaveBeenCalledWith({ requestId: "exit-1", success: true }));
  h.emit();
  expect(h.context.reportExperienceCleanup).toHaveBeenCalledTimes(1);
  h.dispose();
});

test("a live archive handle that cannot close prevents a successful receipt", async () => {
  const handle = { closed: false };
  const h = await install({ archiveWindow: { getHandle: () => handle, close: () => ({ ok: false, reason: "unavailable" }) } });
  await vi.waitFor(() => expect(h.context.reportExperienceCleanup).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.any(String) })));
  h.dispose();
});

test("secondary GIS documents clean local media without asserting owner cleanup", async () => {
  const h = await install({ ownsArchiveCommands: false });
  await vi.waitFor(() => expect(h.viewer.close).toHaveBeenCalledTimes(1));
  expect(h.context.reportExperienceCleanup).not.toHaveBeenCalled();
  h.dispose();
});

test("negative or visibly incomplete presentation closure is reported as failed", async () => {
  const h = await install({ hasPresentation: () => true });
  await vi.waitFor(() => expect(h.context.reportExperienceCleanup).toHaveBeenCalledWith(expect.objectContaining({ success: false })));
  h.dispose();
});

test("an old cleanup completion cannot acknowledge a different pending switch", async () => {
  let release;
  const h = await install({ getPresentationViewer: () => ({ close: () => new Promise(resolve => { release = resolve; }) }) });
  h.emit({ active_experience: "nli", revision: 2, pending_transition: null });
  release();
  await Promise.resolve();
  await Promise.resolve();
  expect(h.context.reportExperienceCleanup).not.toHaveBeenCalled();
  h.dispose();
});
