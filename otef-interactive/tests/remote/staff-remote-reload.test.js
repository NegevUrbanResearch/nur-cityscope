import { expect, test, vi } from "vitest";
import { createStaffRemoteReload } from "../../frontend/src/remote/staff-remote-reload.js";
import { HOME_LAYER_IDS } from "../../frontend/src/remote/nli-staff-script.js";

const remoteId = "11111111-1111-4111-8111-111111111111";
const instanceId = "22222222-2222-4222-8222-222222222222";
const receipt = { schemaVersion: 2, origin: "notice", remoteId, deviceId: remoteId, noticeRevision: 2,
  targetBuildId: "frontend-aaaaaaaaaaaaaaaa", previousInstanceId: instanceId, requestId: remoteId };
function home() {
  return { narrative_state: { id: null, transition: "exit", revision: 1 }, investigation_clock: { phase: "idle", revision: 1 },
    layerGroups: HOME_LAYER_IDS.map(id => ({ id: id.split(".")[0], layers: [{ id: id.split(".")[1], enabled: true }] })),
    person_selection: { personId: null, datasetVersion: null, revision: 0 }, escape_overlay: { individual: false, overlap: false, mor: false, settled: false } };
}
// Each layer is unique, but canonical groups need to combine layers by group.
function snapshot() { const value = home(); const groups = new Map(); value.layerGroups.forEach(group => {
  if (!groups.has(group.id)) groups.set(group.id, { id: group.id, layers: [] }); groups.get(group.id).layers.push(...group.layers);
}); value.layerGroups = [...groups.values()]; return value; }
function setup(options = {}) {
  const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const reload = vi.fn(); const helper = createStaffRemoteReload({ getRefreshState: () => ({ ready: true, refreshBlockReason: null }),
    readCanonicalState: async () => snapshot(), isConnected: () => true, storage, remoteId, instanceId, reload, ...options });
  return { helper, storage, values, reload };
}

test("a cancelled pending notice cannot navigate or write a receipt after its read resolves", async () => {
  let finish; const s = setup({ readCanonicalState: () => new Promise(resolve => { finish = resolve; }) });
  const pending = s.helper.attempt({ owner: "notice", isCurrent: () => true, receipt });
  s.helper.invalidate("notice"); finish(snapshot());
  expect((await pending).result).toBe("cancelled"); expect(s.reload).not.toHaveBeenCalled(); expect(s.values.size).toBe(0);
});
test("one helper serializes callers and notice cancellation does not cancel the operator", async () => {
  let finish; const s = setup({ readCanonicalState: () => new Promise(resolve => { finish = resolve; }) });
  const pending = s.helper.attempt({ owner: "operator", isCurrent: () => true, receipt });
  expect((await s.helper.attempt({ owner: "notice", isCurrent: () => true, receipt })).reason).toBe("busy");
  s.helper.invalidate("notice"); finish(snapshot());
  expect((await pending).result).toBe("reloaded"); expect(s.reload).toHaveBeenCalledTimes(1);
  expect((await s.helper.attempt({ owner: "notice", isCurrent: () => true, receipt })).reason).toBe("busy");
});
test("receipt storage and acknowledgement failure prevent reload", async () => {
  const s = setup();
  expect((await s.helper.attempt({ owner: "notice", isCurrent: () => true, receipt, beforeReload: () => false })).result).toBe("cancelled");
  expect(s.values.size).toBe(0); expect(s.reload).not.toHaveBeenCalled();
  const broken = setup({ storage: { getItem: () => null, removeItem() {}, setItem() { throw Error("blocked"); } } });
  expect((await broken.helper.attempt({ owner: "notice", isCurrent: () => true, receipt })).reason).toBe("storage_unavailable");
  expect(broken.reload).not.toHaveBeenCalled();
});
test("notice receipts are one-shot and expire without a report after Home", async () => {
  let now = 1000; const s = setup({ wallNow: () => now, monotonicNow: () => now });
  await s.helper.attempt({ owner: "notice", isCurrent: () => true, receipt });
  const restored = createStaffRemoteReload({ storage: s.storage, remoteId, wallNow: () => now, monotonicNow: () => now });
  expect(s.values.size).toBe(0); expect(restored.getNoticeReceipt().targetBuildId).toBe("frontend-aaaaaaaaaaaaaaaa");
  expect(restored.getOperatorReceipt()).toBeNull(); restored.noteHomeSuccess(); now += 60000;
  expect(restored.getNoticeReceipt()).toBeNull(); expect(s.reload).toHaveBeenCalledTimes(1);
});
test("a failed presenter navigation remains retryable instead of claiming an update", async () => {
  const s = setup({ reload: () => { throw Error("navigation blocked"); } });
  expect((await s.helper.attempt({ owner: "notice", isCurrent: () => true, receipt })).result).toBe("rejected");
  expect(s.helper.isBusy()).toBe(false); expect(s.values.size).toBe(0);
});
