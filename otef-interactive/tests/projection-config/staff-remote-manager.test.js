import { expect, test, vi } from "vitest";
import { createStaffRemoteManager } from "../../frontend/src/projection-config/staff-remote-manager.js";

const sourceId = "00000000-0000-4000-8000-000000000001";
const remoteId = "00000000-0000-4000-8000-000000000002";
const instanceId = "00000000-0000-4000-8000-000000000003";
const nextInstanceId = "00000000-0000-4000-8000-000000000004";
const requestId = "00000000-0000-4000-8000-000000000005";
const thirdInstanceId = "00000000-0000-4000-8000-000000000006";

function harness() {
  let now = 100;
  const listeners = new Map();
  const sent = [];
  let connected = true;
  const socket = {
    getConnected: () => connected,
    send: vi.fn((message) => { sent.push(message); return true; }),
    on: vi.fn((type, listener) => listeners.set(type, listener)),
    off: vi.fn((type) => listeners.delete(type)),
  };
  const manager = createStaffRemoteManager({ socket, sourceId, monotonicNow: () => now });
  const report = (changes = {}) => listeners.get("otef_staff_remote_status")?.({
    type: "otef_staff_remote_status", table: "otef", remoteId, instanceId, connectionSeq: 1, leaseSeq: 1,
    buildId: "frontend-0123456789abcdef", visibility: "visible", ready: true, refreshBlockReason: null, reloadReceipt: null, ...changes,
  });
  return { manager, socket, sent, listeners, report, setNow(value) { now = value; }, setConnected(value) { connected = value; listeners.get(value ? "connect" : "disconnect")?.(); } };
}

test("subscribes and queries only on an open socket, then orders per-document connection and lease sequences", () => {
  const h = harness();
  expect(h.sent.map((message) => message.type)).toEqual(["otef_staff_remote_subscribe", "otef_staff_remote_status_query"]);
  h.report({ leaseSeq: 2 });
  h.report({ leaseSeq: 1, buildId: "old" });
  h.report({ connectionSeq: 2, leaseSeq: 1, instanceId: nextInstanceId, buildId: null });
  h.report({ connectionSeq: 1, leaseSeq: 99, buildId: "retired" });
  expect(h.manager.getState().remotes).toHaveLength(2);
  expect(h.manager.getState().remotes[0].version).toBe("frontend-0123456789abcdef");
  expect(h.manager.getState().remotes[1].version).toBeNull();
  expect(h.manager.getState().remotes[0].sessionId).not.toBe(h.manager.getState().remotes[1].sessionId);
  h.manager.dispose();
});

test("uses strict staleness and ignores stale connection reports and uncorrelated receipts", () => {
  const h = harness();
  h.report();
  h.setNow(30_100);
  expect(h.manager.getState().remotes[0].status).toBe("Online");
  h.setNow(30_101);
  expect(h.manager.getState().remotes[0].status).toBe("Not responding");
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(false);
  h.setNow(31_000);
  h.listeners.get("otef_staff_remote_disconnected")?.({ type: "otef_staff_remote_disconnected", table: "otef", remoteId, instanceId, connectionSeq: 1 });
  expect(h.manager.getState().remotes[0].status).toBe("Disconnected");
  h.report({ connectionSeq: 2, instanceId: nextInstanceId, leaseSeq: 1 });
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([nextInstanceId]);
  h.report({ connectionSeq: 1, leaseSeq: 9 });
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([nextInstanceId]);
  h.listeners.get("otef_staff_remote_disconnected")?.({ type: "otef_staff_remote_disconnected", table: "otef", remoteId, instanceId, connectionSeq: 1 });
  expect(h.manager.getState().remotes[0].status).toBe("Online");
  h.report({ connectionSeq: 2, instanceId: nextInstanceId, leaseSeq: 2,
    reloadReceipt: { sourceId, requestId, previousInstanceId: instanceId } });
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([nextInstanceId]);
  expect(h.manager.getState().remotes[0].actionStatus).toBe("");
  h.manager.dispose();
});

test("marks all targets unconfirmed while config socket is disconnected and never queues a query", () => {
  const h = harness();
  h.report();
  h.setConnected(false);
  const before = h.sent.length;
  expect(h.manager.getState().connectionStatus).toBe("Connection unavailable");
  expect(h.manager.getState().remotes[0].status).toBe("Connection unavailable");
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(false);
  expect(h.sent).toHaveLength(before);
  h.setConnected(true);
  expect(h.manager.getState().remotes[0].status).toBe("Connection unavailable");
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(false);
  h.report({ leaseSeq: 2 });
  expect(h.manager.getState().remotes[0].status).toBe("Online");
  h.manager.dispose();
});

test("expires action eligibility at lease age above 10,000 ms and reports each server block reason", () => {
  const h = harness();
  h.report();
  h.setNow(10_100);
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(false);
  h.setNow(10_101);
  h.report({ leaseSeq: 2, refreshBlockReason: "not_home" });
  expect(h.manager.getState().remotes[0].blockedCopy).toBe("Return GIS/projection to Home before refreshing");
  h.report({ leaseSeq: 3, refreshBlockReason: "busy" });
  expect(h.manager.getState().remotes[0].blockedCopy).toBe("Remote is busy");
  h.report({ leaseSeq: 4, refreshBlockReason: "owned_session" });
  expect(h.manager.getState().remotes[0].blockedCopy).toBe("Close the archive or presentation before refreshing");
  h.report({ leaseSeq: 5, ready: false, refreshBlockReason: "not_ready" });
  expect(h.manager.getState().remotes[0].actionEnabled).toBe(false);
  h.manager.dispose();
});

test("a matching receipt from a not-ready document does not complete or retire until its higher-lease ready report", () => {
  const h = harness();
  h.report();
  h.report({ instanceId: nextInstanceId, leaseSeq: 1 });
  h.report({ instanceId: thirdInstanceId, leaseSeq: 1 });
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(true);
  const request = h.sent.at(-1);
  const receipt = { sourceId, requestId: request.requestId, previousInstanceId: instanceId };
  h.report({ instanceId: nextInstanceId, leaseSeq: 2, ready: false, refreshBlockReason: "not_ready", reloadReceipt: receipt });
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([instanceId, nextInstanceId, thirdInstanceId]);
  expect(h.manager.getState().remotes[1].actionStatus).not.toBe("Tablet reloaded to Home");
  h.report({ instanceId: nextInstanceId, leaseSeq: 3, ready: true, refreshBlockReason: null, reloadReceipt: receipt });
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([nextInstanceId, thirdInstanceId]);
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Tablet reloaded to Home");
  h.manager.dispose();
});

test("a higher connection sequence retires the prior same-document connection and rejects its delayed disconnect", () => {
  const h = harness();
  h.report();
  h.report({ connectionSeq: 2, leaseSeq: 1 });
  h.listeners.get("otef_staff_remote_disconnected")?.({ type: "otef_staff_remote_disconnected", table: "otef", remoteId, instanceId, connectionSeq: 1 });
  expect(h.manager.getState().remotes).toHaveLength(1);
  expect(h.manager.getState().remotes[0]).toMatchObject({ connectionSeq: 2, status: "Online" });
  h.report({ connectionSeq: 1, leaseSeq: 99 });
  expect(h.manager.getState().remotes[0]).toMatchObject({ connectionSeq: 2, status: "Online" });
  h.manager.dispose();
});

test("hides an explicitly disconnected document after manual reload in either status/disconnect order", () => {
  for (const disconnectFirst of [false, true]) {
    const h = harness();
    h.report({ instanceId });
    const disconnect = () => h.listeners.get("otef_staff_remote_disconnected")?.({
      type: "otef_staff_remote_disconnected", table: "otef", remoteId, instanceId, connectionSeq: 1,
    });
    if (disconnectFirst) disconnect();
    h.report({ instanceId: nextInstanceId, connectionSeq: 1, leaseSeq: 1 });
    if (!disconnectFirst) disconnect();
    expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([nextInstanceId]);
    h.manager.dispose();
  }
});

test("keeps live cloned tabs separate and keeps the latest representative when all same-remote documents disconnect", () => {
  const h = harness();
  h.report({ instanceId });
  h.setNow(101);
  h.report({ instanceId: nextInstanceId, connectionSeq: 1, leaseSeq: 1 });
  h.setNow(102);
  h.report({ instanceId: thirdInstanceId, connectionSeq: 1, leaseSeq: 1 });
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([instanceId, nextInstanceId, thirdInstanceId]);

  const disconnect = (id) => h.listeners.get("otef_staff_remote_disconnected")?.({
    type: "otef_staff_remote_disconnected", table: "otef", remoteId, instanceId: id, connectionSeq: 1,
  });
  disconnect(instanceId);
  disconnect(nextInstanceId);
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([thirdInstanceId]);
  disconnect(thirdInstanceId);
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([thirdInstanceId]);
  h.manager.dispose();
});

test("keeps a disconnected refresh target visible through its original deadline, then hides it", () => {
  vi.useFakeTimers();
  const h = harness();
  h.report({ instanceId });
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(true);
  const request = h.sent.at(-1);
  h.listeners.get("otef_staff_remote_disconnected")?.({
    type: "otef_staff_remote_disconnected", table: "otef", remoteId, instanceId, connectionSeq: 1,
  });
  h.report({ instanceId: nextInstanceId, connectionSeq: 1, leaseSeq: 1 });
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([instanceId, nextInstanceId]);
  vi.advanceTimersByTime(5_000);
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([nextInstanceId]);
  expect(h.sent.filter((message) => message.type === "otef_staff_remote_refresh")).toHaveLength(1);
  expect(request.remoteId).toBe(remoteId);
  h.manager.dispose();
  vi.useRealTimers();
});

test("a hidden disconnected row reappears on a higher connection sequence as a clone", () => {
  const h = harness();
  h.report({ instanceId });
  h.listeners.get("otef_staff_remote_disconnected")?.({
    type: "otef_staff_remote_disconnected", table: "otef", remoteId, instanceId, connectionSeq: 1,
  });
  h.report({ instanceId: nextInstanceId, connectionSeq: 1, leaseSeq: 1 });
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([nextInstanceId]);
  h.report({ instanceId, connectionSeq: 2, leaseSeq: 1 });
  expect(h.manager.getState().remotes.map((row) => row.instanceId)).toEqual([instanceId, nextInstanceId]);
  expect(h.manager.getState().remotes[0]).toMatchObject({ connectionSeq: 2, status: "Online" });
  h.manager.dispose();
});

test("a snapshot with an old lease sends the current stored lease for that document", () => {
  const h = harness();
  h.report({ leaseSeq: 1 });
  const oldSnapshot = h.manager.getState().remotes[0];
  h.report({ leaseSeq: 2 });
  expect(h.manager.refresh(oldSnapshot)).toBe(true);
  expect(h.sent.at(-1).leaseSeq).toBe(2);
  h.manager.dispose();
});

test("sends one targeted refresh per click and distinguishes accepted acknowledgement from correlated completion", () => {
  const h = harness();
  h.report();
  const row = h.manager.getState().remotes[0];
  expect(row.blockedCopy).toBe("");
  expect(h.manager.refresh(row)).toBe(true);
  const request = h.sent.at(-1);
  expect(request).toMatchObject({ type: "otef_staff_remote_refresh", table: "otef", remoteId, instanceId, connectionSeq: 1, leaseSeq: 1 });
  expect(h.manager.refresh(row)).toBe(false);
  h.listeners.get("otef_staff_remote_refresh_ack")?.({ type: "otef_staff_remote_refresh_ack", table: "otef", sourceId,
    requestId: request.requestId, remoteId, instanceId, connectionSeq: 1, result: "accepted", reason: null });
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Reload accepted");
  expect(h.manager.getState().remotes).toHaveLength(1);
  h.report({ instanceId: nextInstanceId, connectionSeq: 1, leaseSeq: 1,
    reloadReceipt: { sourceId, requestId: request.requestId, previousInstanceId: instanceId } });
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Tablet reloaded to Home");
  h.manager.dispose();
});

test("receipt before ACK completes the request while an unrelated cloned tab remains present", () => {
  const h = harness();
  h.report();
  h.report({ instanceId: nextInstanceId, connectionSeq: 1, leaseSeq: 1 });
  h.report({ instanceId: thirdInstanceId, connectionSeq: 1, leaseSeq: 1 });
  const row = h.manager.getState().remotes.find((item) => item.instanceId === instanceId);
  expect(h.manager.refresh(row)).toBe(true);
  const request = h.sent.at(-1);
  h.report({ instanceId: nextInstanceId, connectionSeq: 1, leaseSeq: 2,
    reloadReceipt: { sourceId, requestId: request.requestId, previousInstanceId: instanceId } });
  expect(h.manager.getState().remotes.map((item) => item.instanceId)).toEqual([nextInstanceId, thirdInstanceId]);
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Tablet reloaded to Home");
  h.listeners.get("otef_staff_remote_refresh_ack")?.({ type: "otef_staff_remote_refresh_ack", table: "otef", sourceId,
    requestId: request.requestId, remoteId, instanceId, connectionSeq: 1, result: "accepted", reason: null });
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Tablet reloaded to Home");
  h.manager.dispose();
});

test("send failure, rejection, 5 second confirmation timeout, and 30 second completion timeout stay truthful", () => {
  vi.useFakeTimers();
  const h = harness();
  h.report();
  const row = h.manager.getState().remotes[0];
  h.socket.send.mockReturnValueOnce(false);
  expect(h.manager.refresh(row)).toBe(false);
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Refresh not sent");
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(true);
  let request = h.sent.at(-1);
  h.listeners.get("otef_staff_remote_refresh_ack")?.({ type: "otef_staff_remote_refresh_ack", table: "otef", sourceId,
    requestId: request.requestId, remoteId, instanceId, connectionSeq: 1, result: "rejected", reason: "busy" });
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Remote is busy");
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(true);
  vi.advanceTimersByTime(5_000);
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Refresh not confirmed");
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(true);
  request = h.sent.at(-1);
  h.listeners.get("otef_staff_remote_refresh_ack")?.({ type: "otef_staff_remote_refresh_ack", table: "otef", sourceId,
    requestId: request.requestId, remoteId, instanceId, connectionSeq: 1, result: "accepted", reason: null });
  vi.advanceTimersByTime(30_000);
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Refresh not confirmed");
  h.manager.dispose();
  vi.useRealTimers();
});

test("a timed-out request can complete from its late same-version receipt without replay", () => {
  vi.useFakeTimers();
  const h = harness();
  h.report();
  const row = h.manager.getState().remotes[0];
  expect(h.manager.refresh(row)).toBe(true);
  const request = h.sent.at(-1);
  vi.advanceTimersByTime(5_000);
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Refresh not confirmed");
  h.report({ instanceId: nextInstanceId, connectionSeq: 1, leaseSeq: 1, buildId: "frontend-0123456789abcdef",
    reloadReceipt: { sourceId, requestId: request.requestId, previousInstanceId: instanceId } });
  expect(h.manager.getState().remotes[0].actionStatus).toBe("Tablet reloaded to Home");
  expect(h.sent.filter((message) => message.type === "otef_staff_remote_refresh")).toHaveLength(1);
  h.manager.dispose();
  vi.useRealTimers();
});

test("late ACK for request A cannot change request B and duplicate acceptance cannot restart its deadline", () => {
  vi.useFakeTimers();
  const h = harness();
  h.report({ leaseSeq: 1 });
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(true);
  const requestA = h.sent.at(-1);
  vi.advanceTimersByTime(5_000);
  h.report({ leaseSeq: 2 });
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(true);
  const requestB = h.sent.at(-1);
  h.listeners.get("otef_staff_remote_refresh_ack")?.({ type: "otef_staff_remote_refresh_ack", table: "otef", sourceId,
    requestId: requestB.requestId, remoteId, instanceId, connectionSeq: 1, result: "accepted", reason: null });
  const statusAtAcceptance = h.manager.getState().remotes[0].actionStatus;
  vi.advanceTimersByTime(20_000);
  h.listeners.get("otef_staff_remote_refresh_ack")?.({ type: "otef_staff_remote_refresh_ack", table: "otef", sourceId,
    requestId: requestA.requestId, remoteId, instanceId, connectionSeq: 1, result: "rejected", reason: "busy" });
  h.listeners.get("otef_staff_remote_refresh_ack")?.({ type: "otef_staff_remote_refresh_ack", table: "otef", sourceId,
    requestId: requestB.requestId, remoteId, instanceId, connectionSeq: 1, result: "accepted", reason: null });
  expect(h.manager.getState().remotes[0]).toMatchObject({ actionStatus: statusAtAcceptance, pending: requestB.requestId });
  vi.advanceTimersByTime(10_000);
  expect(h.manager.getState().remotes[0]).toMatchObject({ actionStatus: "Refresh not confirmed", pending: null });
  h.manager.dispose();
  vi.useRealTimers();
});

test("a pending request keeps ownership across exact disconnect and same-document reconnect until its original deadline", () => {
  vi.useFakeTimers();
  const h = harness();
  h.report({ connectionSeq: 1, leaseSeq: 1 });
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(true);
  const request = h.sent.at(-1);

  h.listeners.get("otef_staff_remote_disconnected")?.({ type: "otef_staff_remote_disconnected", table: "otef", remoteId, instanceId, connectionSeq: 1 });
  expect(h.manager.getState().remotes[0]).toMatchObject({ status: "Disconnected", pending: request.requestId, actionEnabled: false });
  vi.advanceTimersByTime(1_000);
  h.report({ connectionSeq: 2, leaseSeq: 1 });
  expect(h.manager.getState().remotes[0]).toMatchObject({ status: "Online", pending: request.requestId, actionEnabled: false });
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(false);

  vi.advanceTimersByTime(4_000);
  expect(h.manager.getState().remotes[0]).toMatchObject({ pending: null, actionStatus: "Refresh not confirmed", actionEnabled: true });
  expect(h.sent.filter((message) => message.type === "otef_staff_remote_refresh")).toHaveLength(1);
  h.manager.dispose();
  vi.useRealTimers();
});

test("an accepted request keeps ownership across exact disconnect and reconnect until its original completion deadline", () => {
  vi.useFakeTimers();
  const h = harness();
  h.report({ connectionSeq: 1, leaseSeq: 1 });
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(true);
  const request = h.sent.at(-1);
  h.listeners.get("otef_staff_remote_refresh_ack")?.({ type: "otef_staff_remote_refresh_ack", table: "otef", sourceId,
    requestId: request.requestId, remoteId, instanceId, connectionSeq: 1, result: "accepted", reason: null });

  vi.advanceTimersByTime(2_000);
  h.listeners.get("otef_staff_remote_disconnected")?.({ type: "otef_staff_remote_disconnected", table: "otef", remoteId, instanceId, connectionSeq: 1 });
  h.report({ connectionSeq: 2, leaseSeq: 1 });
  expect(h.manager.getState().remotes[0]).toMatchObject({ pending: request.requestId, actionStatus: "Reload accepted", actionEnabled: false });
  expect(h.manager.refresh(h.manager.getState().remotes[0])).toBe(false);

  vi.advanceTimersByTime(28_000);
  expect(h.manager.getState().remotes[0]).toMatchObject({ pending: null, actionStatus: "Refresh not confirmed", actionEnabled: true });
  expect(h.sent.filter((message) => message.type === "otef_staff_remote_refresh")).toHaveLength(1);
  h.manager.dispose();
  vi.useRealTimers();
});

test("a disconnect tombstone received before its first status prevents that connection from appearing", () => {
  const h = harness();
  h.listeners.get("otef_staff_remote_disconnected")?.({ type: "otef_staff_remote_disconnected", table: "otef", remoteId, instanceId, connectionSeq: 1 });
  h.report({ connectionSeq: 1, leaseSeq: 1 });
  expect(h.manager.getState().remotes).toHaveLength(0);
  h.report({ connectionSeq: 2, leaseSeq: 1 });
  expect(h.manager.getState().remotes).toHaveLength(1);
  expect(h.manager.getState().remotes[0].actionEnabled).toBe(true);
  h.manager.dispose();
});

test("dispose removes socket listeners and disconnect plus reconnect never replays refresh", () => {
  const h = harness();
  h.report();
  const row = h.manager.getState().remotes[0];
  expect(h.manager.refresh(row)).toBe(true);
  const requests = h.sent.filter((message) => message.type === "otef_staff_remote_refresh").length;
  h.setConnected(false); h.setConnected(true);
  expect(h.sent.filter((message) => message.type === "otef_staff_remote_refresh")).toHaveLength(requests);
  h.manager.dispose();
  expect(h.listeners.size).toBe(0);
});
