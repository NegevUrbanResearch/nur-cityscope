import { expect, test, vi } from "vitest";
import { isCanonicalRegularIdle, getRegularRemoteRefreshState } from "../../frontend/src/remote/regular-remote-refresh.js";
import { createStaffRemoteReload } from "../../frontend/src/remote/staff-remote-reload.js";

const idle = () => ({ experience_state: { active_experience: "regular", revision: 4, pending_transition: null },
  narrative_state: { id: null }, investigation_clock: { phase: "idle" }, projection_slideshow: null });

test("regular idle permits any static map and person selection without requiring NLI Home", () => {
  expect(isCanonicalRegularIdle({ ...idle(), person_selection: { personId: "static-person" }, layerGroups: [] })).toBe(true);
  expect(isCanonicalRegularIdle({})).toBe(false);
  expect(isCanonicalRegularIdle({ ...idle(), projection_slideshow: {} })).toBe(true);
});
test.each([
  { experience_state: { active_experience: "nli", revision: 4 } },
  { experience_state: { active_experience: "regular", revision: 4, pending_transition: {} } },
  { narrative_state: { id: "nova" } }, { investigation_clock: { phase: "paused" } },
  { investigation_clock: { phase: "idle", presentationPendingUntilMs: Date.now() + 60000 } },
  { projection_slideshow: { type: "start" } },
])("regular refresh rejects active presentation or transition %j", patch => {
  expect(isCanonicalRegularIdle({ ...idle(), ...patch })).toBe(false);
});
test("local pending writes and active interaction block refresh", () => {
  const dataContext = { isConnected: () => true, getExperienceState: () => idle().experience_state,
    getNarrativeState: () => idle().narrative_state, getInvestigationClock: () => idle().investigation_clock,
    getProjectionSlideshow: () => null };
  expect(getRegularRemoteRefreshState({ dataContext, busy: false })).toEqual({ ready: true, refreshBlockReason: null });
  expect(getRegularRemoteRefreshState({ dataContext, busy: true }).refreshBlockReason).toBe("busy");
});
test("regular canonical policy reloads only after fresh state and local recheck", async () => {
  const reload = vi.fn(), values = new Map(); let busy = false;
  const remoteId = "11111111-1111-4111-8111-111111111111";
  const controller = createStaffRemoteReload({ remoteId, isConnected: () => true, reload,
    getRefreshState: () => ({ ready: true, refreshBlockReason: busy ? "busy" : null }),
    isCanonicalRefreshSafe: isCanonicalRegularIdle, readCanonicalState: async () => idle(),
    storage: { getItem: key => values.get(key), removeItem: key => values.delete(key), setItem: (key, value) => values.set(key, value) } });
  const attempt = () => controller.attempt({ owner: "operator", isCurrent: () => true,
    receipt: { schemaVersion: 1, remoteId, sourceId: remoteId, requestId: remoteId, previousInstanceId: remoteId } });
  busy = true; expect((await attempt()).reason).toBe("busy");
  busy = false; expect((await attempt()).result).toBe("reloaded"); expect(reload).toHaveBeenCalledOnce();
});

test("regular canonical race reports an owned session instead of requiring NLI Home", async () => {
  const helper = createStaffRemoteReload({ getRefreshState: () => ({ ready: true, refreshBlockReason: null }),
    isConnected: () => true, isCanonicalRefreshSafe: isCanonicalRegularIdle, canonicalBlockReason: "owned_session",
    readCanonicalState: async () => ({ ...idle(), projection_slideshow: { type: "start" } }) });
  expect(await helper.attempt({ owner: "operator", isCurrent: () => true })).toEqual({ result: "rejected", reason: "owned_session" });
  const nli = createStaffRemoteReload({ getRefreshState: () => ({ ready: true, refreshBlockReason: null }),
    isConnected: () => true, readCanonicalState: async () => idle() });
  expect(await nli.attempt({ owner: "operator", isCurrent: () => true })).toEqual({ result: "rejected", reason: "not_home" });
});
