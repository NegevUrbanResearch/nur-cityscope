import { expect, test, vi } from "vitest";
import { createStaffRemoteUpdates } from "../../frontend/src/remote/staff-remote-updates.js";
import { createStaffRemoteReload } from "../../frontend/src/remote/staff-remote-reload.js";

const deviceId = "11111111-1111-4111-8111-111111111111";
const A = "frontend-aaaaaaaaaaaaaaaa", B = "frontend-bbbbbbbbbbbbbbbb";
const notice = (revision = 2, targetBuildId = A) => ({ table: "otef", revision, deviceId,
  notice: { revision, targetBuildId, createdAt: "2026-10-10T00:00:00Z" } });
const tick = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function setup(options = {}) {
  let server = notice(), build = A, refreshState = { ready: true, refreshBlockReason: null };
  const values = options.values || new Map([["otef-exhibit-device-id", deviceId]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const handlers = new Map(); const socket = { getConnected: () => true, on: (key, callback) => handlers.set(key, callback), off: key => handlers.delete(key) };
  const reloads = [];
  const reloader = { invalidate: vi.fn(), getNoticeReceipt: () => null, attempt: async args => {
    if (!args.isCurrent()) return { result: "cancelled", reason: null };
    reloads.push(args.receipt); return { result: "reloaded", reason: null };
  } };
  const api = { read: async () => server, register: async args => { server = { table: "otef", revision: 1, deviceId: args.deviceId, notice: null }; return server; } };
  const updates = createStaffRemoteUpdates({ api, readBuildId: async () => build, loadedBuildId: B,
    socket, reloadController: reloader, getIdentity: () => ({ remoteId: deviceId, instanceId: deviceId, connectionSeq: 1 }),
    reportBinding: () => {}, getRefreshState: () => refreshState, localStorage: storage, document: new EventTarget(), window: new EventTarget(), ...options });
  return { updates, values, api, reloads, handlers, setServer: value => { server = value; }, setBuild: value => { build = value; },
    setRefresh: value => { refreshState = value; updates.refreshStateChanged(); } };
}

test("old-page wake shows a manually saved notice; current/no-notice startup stays hidden", async () => {
  const s = setup(); await s.updates.reconcile(); expect(s.updates.getState().mode).toBe("ready");
  const empty = setup({ api: { read: async () => ({ table: "otef", revision: 1, deviceId, notice: null }) } });
  await empty.updates.reconcile(); expect(empty.updates.getState().mode).toBe("hidden"); expect(s.reloads).toHaveLength(0);
  const current = setup({ loadedBuildId: A }); await current.updates.reconcile(); expect(current.updates.getState().mode).toBe("hidden");
  s.updates.dispose(); current.updates.dispose(); empty.updates.dispose();
});
test("dismissal survives a new controller, leaves a reminder and permits deliberate reopening", async () => {
  const s = setup(); await s.updates.reconcile(); s.updates.dismiss(); expect(s.updates.getState().mode).toBe("reminder"); s.updates.dispose();
  const resumed = setup({ values: s.values }); await resumed.updates.reconcile(); expect(resumed.updates.getState().mode).toBe("reminder");
  resumed.updates.reopen(); expect(resumed.updates.getState().mode).toBe("ready");
  expect(JSON.parse(s.values.get("otef-exhibit-dismissed-notice"))).toEqual({ deviceId, revision: 2 }); resumed.updates.dispose();
});
test("a signal during an active read performs one fresh reconciliation for the newer notice", async () => {
  let resolve, reads = 0; let value = notice();
  const s = setup({ api: { read: () => ++reads === 1 ? new Promise(done => { resolve = done; }) : Promise.resolve(value) }, loadedBuildId: "frontend-cccccccccccccccc" });
  await tick(); value = notice(3, B); s.setBuild(B);
  s.handlers.get("otef_staff_remote_notice_changed_v1")({ type: "otef_staff_remote_notice_changed_v1", table: "otef", revision: 3 });
  resolve(notice()); await s.updates.reconcile();
  expect(reads).toBe(2); expect(s.updates.getState().noticeRevision).toBe(3); expect(s.updates.getState().mode).toBe("ready"); s.updates.dispose();
});
test("Continue during preflight prevents a late successful check from reloading", async () => {
  const s = setup(); await s.updates.reconcile(); let resolve;
  s.api.read = () => new Promise(done => { resolve = done; });
  const attempt = s.updates.refresh(); await tick(); s.updates.dismiss(); resolve(notice()); await attempt;
  expect(s.reloads).toHaveLength(0); expect(s.updates.getState().mode).toBe("reminder"); s.updates.dispose();
});
test("busy state defers the modal and a newer revision requires another deliberate tap", async () => {
  const s = setup(); await s.updates.reconcile(); s.setRefresh({ ready: true, refreshBlockReason: "owned_session" });
  expect(s.updates.getState().mode).toBe("reminder"); expect((await s.updates.refresh()).result).toBe("cancelled");
  s.setRefresh({ ready: true, refreshBlockReason: null }); expect(s.updates.getState().mode).toBe("ready");
  s.setServer(notice(3)); await s.updates.refresh(); expect(s.reloads).toHaveLength(0);
  await s.updates.refresh(); expect(s.reloads).toHaveLength(1); expect(s.reloads[0].noticeRevision).toBe(3); s.updates.dispose();
});
test("retired candidate still reports binding and registration retry retains the stored ID", async () => {
  const attempts = [], bindings = [];
  const api = { read: async (args = {}) => { const error = Error("retired"); error.code = "unregistered"; error.state = { table: "otef", revision: 4, deviceId: "22222222-2222-4222-8222-222222222222", notice: null }; if (!args.deviceId) return error.state; throw error; },
    register: async args => { attempts.push(args.deviceId); throw Error("response lost"); } };
  const s = setup({ api, reportBinding: () => bindings.push(true) }); await s.updates.reconcile();
  expect(s.updates.getStoredDeviceId()).toBe(deviceId); expect(s.updates.getState().registration).toBe("unregistered"); expect(bindings.length).toBeGreaterThan(0);
  await s.updates.register({ replaceDeviceId: "22222222-2222-4222-8222-222222222222" });
  await s.updates.register({ replaceDeviceId: "22222222-2222-4222-8222-222222222222" });
  expect(attempts).toEqual([deviceId, deviceId]); s.updates.dispose();
});
test("retiring a registered browser invalidates an operator check already in flight", async () => {
  let finish;
  const reload = vi.fn();
  const helper = createStaffRemoteReload({ remoteId: deviceId, isConnected: () => true,
    getRefreshState: () => ({ ready: true, refreshBlockReason: null }),
    readCanonicalState: () => new Promise(resolve => { finish = resolve; }), reload });
  const s = setup({ reloadController: helper }); await s.updates.reconcile();
  const pending = helper.attempt({ owner: "operator", isCurrent: () => true, receipt: {} });
  s.api.read = async () => { const error = Error("retired"); error.code = "unregistered"; throw error; };
  await s.updates.reconcile(); finish({});
  expect((await pending).result).toBe("cancelled"); expect(reload).not.toHaveBeenCalled();
  s.updates.dispose(); helper.dispose();
});
test("failed notice receipt is recognized when reconciliation finishes before Home becomes ready", async () => {
  let ready = false;
  const helper = { invalidate() {}, getNoticeReceipt: () => ({ deviceId, noticeRevision: 2, targetBuildId: A }) };
  const s = setup({ reloadController: helper, getRefreshState: () => ({ ready, refreshBlockReason: ready ? null : "not_ready" }) });
  await s.updates.reconcile(); expect(s.updates.getState().mode).toBe("reminder");
  ready = true; s.updates.refreshStateChanged(); expect(s.updates.getState().mode).toBe("failed");
  s.setServer(notice(3)); await s.updates.reconcile(); expect(s.updates.getState().mode).toBe("ready");
  s.updates.dispose();
});
