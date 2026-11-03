import { afterEach, describe, expect, it, vi } from "vitest";
import { createStaffRemoteManagement } from "../../frontend/src/remote/staff-remote-management.js";
import { HOME_LAYER_IDS } from "../../frontend/src/remote/nli-staff-script.js";

const ids = {
  remote: "11111111-1111-4111-8111-111111111111",
  instance: "22222222-2222-4222-8222-222222222222",
  source: "33333333-3333-4333-8333-333333333333",
  request: "44444444-4444-4444-8444-444444444444",
};

function groupsFor(enabledIds) {
  const groups = new Map();
  for (const fullId of enabledIds) {
    const [groupId, layerId] = fullId.split(".");
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, enabled: true, layers: [] });
    groups.get(groupId).layers.push({ id: layerId, enabled: true });
  }
  return [...groups.values()];
}

function homeSnapshot() {
  return {
    narrative_state: { id: null, transition: "exit", revision: 1 },
    investigation_clock: { phase: "idle", revision: 1, presentationPendingUntilMs: 0 },
    layerGroups: groupsFor(HOME_LAYER_IDS),
    person_selection: { personId: null, datasetVersion: null, revision: 0 },
    escape_overlay: { individual: false, overlap: false, mor: false, settled: false },
    nowMs: 100_000,
  };
}

function refresh(s, status, requestId = ids.request, overrides = {}) {
  s.socket.emit("otef_staff_remote_refresh", {
    type: "otef_staff_remote_refresh", table: "otef", sourceId: ids.source, requestId,
    remoteId: ids.remote, instanceId: ids.instance, connectionSeq: status.connectionSeq,
    leaseSeq: status.leaseSeq, ...overrides,
  });
}

function setup(overrides = {}) {
  let wall = 100_000;
  let mono = 10_000;
  const handlers = new Map();
  const sent = [];
  const socket = {
    isConnected: true,
    ws: { readyState: 1, bufferedAmount: 0 },
    getConnected: () => socket.isConnected,
    on: (name, fn) => handlers.set(name, [...(handlers.get(name) || []), fn]),
    off: (name, fn) => handlers.set(name, (handlers.get(name) || []).filter((item) => item !== fn)),
    send: vi.fn((message) => { sent.push(message); return overrides.sendResult ?? true; }),
    emit: (name, message = {}) => (handlers.get(name) || []).forEach((fn) => fn(message)),
  };
  const values = new Map();
  const storage = {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
  };
  const winHandlers = new Map();
  const window = {
    sessionStorage: storage,
    location: { reload: vi.fn() },
    addEventListener: (name, fn) => winHandlers.set(name, [...(winHandlers.get(name) || []), fn]),
    removeEventListener: (name, fn) => winHandlers.set(name, (winHandlers.get(name) || []).filter((item) => item !== fn)),
    dispatch: (name) => (winHandlers.get(name) || []).forEach((fn) => fn()),
  };
  const docHandlers = new Map();
  const document = {
    visibilityState: "visible",
    addEventListener: (name, fn) => docHandlers.set(name, [...(docHandlers.get(name) || []), fn]),
    removeEventListener: (name, fn) => docHandlers.set(name, (docHandlers.get(name) || []).filter((item) => item !== fn)),
    dispatchEvent: (event) => (docHandlers.get(event.type) || []).forEach((fn) => fn(event)),
  };
  const readCanonicalState = vi.fn(async () => homeSnapshot());
  const reload = vi.fn();
  const management = createStaffRemoteManagement({
    socket, buildId: "frontend-test", getRefreshState: () => ({ ready: true, refreshBlockReason: null }),
    readCanonicalState, storage, window, document, wallNow: () => wall,
    monotonicNow: () => mono, reload, ids: { remoteId: ids.remote, instanceId: ids.instance },
    ...overrides,
  });
  return {
    management, socket, sent, storage, values, window, document, readCanonicalState, reload,
    setTime: (nextWall, nextMono) => { wall = nextWall; mono = nextMono; },
    setReady: overrides.setReady,
  };
}

afterEach(() => vi.useRealTimers());

describe("staff remote management", () => {
  it("reports immediately, every 10 seconds, on visible and status query, without catch-up", () => {
    vi.useFakeTimers();
    const s = setup();
    expect(s.sent.filter((m) => m.type === "otef_staff_remote_status")).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(s.sent.filter((m) => m.type === "otef_staff_remote_status")).toHaveLength(2);
    vi.advanceTimersByTime(35_000);
    expect(s.sent.filter((m) => m.type === "otef_staff_remote_status")).toHaveLength(5);
    s.setTime(500_000, 500_000);
    vi.advanceTimersByTime(10_000);
    expect(s.sent.filter((m) => m.type === "otef_staff_remote_status")).toHaveLength(6);
    expect(new TextEncoder().encode(JSON.stringify(s.sent[0])).byteLength).toBeLessThan(1_024);
    expect(s.readCanonicalState).not.toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
    s.document.visibilityState = "visible";
    s.document.dispatchEvent(new Event("visibilitychange"));
    s.socket.emit("otef_staff_remote_status_query", { type: "otef_staff_remote_status_query", table: "otef", sourceId: ids.source });
    s.socket.emit("connect");
    expect(s.sent.filter((m) => m.type === "otef_staff_remote_status")).toHaveLength(9);
    s.management.dispose();
  });

  it("skips periodic reports while disconnected or buffered above 64 KiB and cleans up its timer", () => {
    vi.useFakeTimers();
    const s = setup();
    const initial = s.sent.length;
    s.socket.ws.bufferedAmount = 65_537;
    vi.advanceTimersByTime(10_000);
    expect(s.sent).toHaveLength(initial);
    s.socket.ws.bufferedAmount = 0;
    s.socket.isConnected = false;
    vi.advanceTimersByTime(10_000);
    expect(s.sent).toHaveLength(initial);
    s.management.dispose();
    vi.advanceTimersByTime(30_000);
    expect(s.sent).toHaveLength(initial);
  });

  it("accepts one correctly targeted fresh Home request and saves receipt before ACK and reload", async () => {
    const s = setup();
    const status = s.sent.find((m) => m.type === "otef_staff_remote_status");
    s.socket.emit("otef_staff_remote_refresh", {
      type: "otef_staff_remote_refresh", table: "otef", sourceId: ids.source, requestId: ids.request,
      remoteId: ids.remote, instanceId: ids.instance, connectionSeq: status.connectionSeq, leaseSeq: status.leaseSeq,
    });
    await vi.waitFor(() => expect(s.reload).toHaveBeenCalledOnce());
    const receipt = JSON.parse([...s.values.values()][0]);
    expect(receipt).toMatchObject({ schemaVersion: 1, remoteId: ids.remote, sourceId: ids.source,
      requestId: ids.request, previousInstanceId: ids.instance, savedAtMs: 100_000 });
    expect(s.sent.at(-1)).toMatchObject({ type: "otef_staff_remote_refresh_ack", result: "accepted" });
    expect(s.readCanonicalState).toHaveBeenCalledOnce();
    expect(s.reload).toHaveBeenCalledOnce();
    s.management.dispose();
  });

  it("ignores duplicates and never reloads twice in one document", async () => {
    const s = setup();
    const status = s.sent[0];
    refresh(s, status);
    await vi.waitFor(() => expect(s.reload).toHaveBeenCalledOnce());
    const acceptedCount = s.sent.filter((message) => message.result === "accepted").length;
    refresh(s, status);
    refresh(s, status, "55555555-5555-4555-8555-555555555555");
    expect(s.reload).toHaveBeenCalledOnce();
    expect(s.readCanonicalState).toHaveBeenCalledOnce();
    expect(s.sent.filter((message) => message.result === "accepted")).toHaveLength(acceptedCount);
    expect(s.sent.at(-1)).toMatchObject({ result: "rejected", reason: "busy" });
    s.management.dispose();
  });

  it.each(["not_ready", "busy", "owned_session"])("rejects current local restriction %s", async (reason) => {
    const s = setup({ getRefreshState: () => ({ ready: reason !== "not_ready", refreshBlockReason: reason }) });
    const status = s.sent.find((m) => m.type === "otef_staff_remote_status");
    s.socket.emit("otef_staff_remote_refresh", {
      type: "otef_staff_remote_refresh", table: "otef", sourceId: ids.source, requestId: ids.request,
      remoteId: ids.remote, instanceId: ids.instance, connectionSeq: status.connectionSeq, leaseSeq: status.leaseSeq,
    });
    await vi.waitFor(() => expect(s.sent.at(-1)?.type).toBe("otef_staff_remote_refresh_ack"));
    expect(s.sent.at(-1)).toMatchObject({ result: "rejected", reason });
    expect(s.readCanonicalState).not.toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
    s.management.dispose();
  });

  it("lets the fresh canonical Home read override a stale cached not_home report", async () => {
    const s = setup({ getRefreshState: () => ({ ready: true, refreshBlockReason: "not_home" }) });
    const status = s.sent[0];
    expect(status.refreshBlockReason).toBe("not_home");
    refresh(s, status);
    await vi.waitFor(() => expect(s.reload).toHaveBeenCalledOnce());
    expect(s.readCanonicalState).toHaveBeenCalledOnce();
    s.management.dispose();
  });

  it("fails closed on a malformed restriction result", async () => {
    const s = setup({ getRefreshState: () => ({ ready: true, refreshBlockReason: "unknown" }) });
    expect(s.sent[0]).toMatchObject({ ready: false, refreshBlockReason: "not_ready" });
    refresh(s, s.sent[0]);
    expect(s.sent.at(-1)).toMatchObject({ result: "rejected", reason: "not_ready" });
    expect(s.readCanonicalState).not.toHaveBeenCalled();
    s.management.dispose();
  });

  it("rejects wrong targets, generations and leases without a fresh read", async () => {
    const s = setup();
    const status = s.sent.find((m) => m.type === "otef_staff_remote_status");
    for (const delta of [
      { remoteId: ids.source }, { instanceId: ids.source },
      { connectionSeq: status.connectionSeq + 1 }, { leaseSeq: status.leaseSeq + 1 },
    ]) s.socket.emit("otef_staff_remote_refresh", {
      type: "otef_staff_remote_refresh", table: "otef", sourceId: ids.source, requestId: ids.request,
      remoteId: ids.remote, instanceId: ids.instance, connectionSeq: status.connectionSeq, leaseSeq: status.leaseSeq, ...delta,
    });
    expect(s.readCanonicalState).not.toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
    s.management.dispose();
  });

  it("forwards a private AbortSignal and rejects non-Home fresh state", async () => {
    const s = setup({ readCanonicalState: vi.fn(async ({ signal }) => { expect(signal).toBeInstanceOf(AbortSignal); return {}; }) });
    const status = s.sent[0];
    s.socket.emit("otef_staff_remote_refresh", {
      type: "otef_staff_remote_refresh", table: "otef", sourceId: ids.source, requestId: ids.request,
      remoteId: ids.remote, instanceId: ids.instance, connectionSeq: status.connectionSeq, leaseSeq: status.leaseSeq,
    });
    await vi.waitFor(() => expect(s.sent.at(-1)?.type).toBe("otef_staff_remote_refresh_ack"));
    expect(s.sent.at(-1)).toMatchObject({ result: "rejected", reason: "not_home" });
    expect(s.reload).not.toHaveBeenCalled();
    s.management.dispose();
  });

  it("receipt parsing is one-shot and malformed or expired receipts do not trigger reload", () => {
    const s = setup();
    expect(s.storage.getItem).toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
    s.management.dispose();
  });

  it("rejects a lease after sleep, backward time, or a superseding report", async () => {
    for (const movement of [[110_001, 20_001], [99_999, 9_999]]) {
      const s = setup();
      const status = s.sent[0];
      s.setTime(...movement);
      refresh(s, status);
      expect(s.sent.at(-1)).toMatchObject({ result: "rejected", reason: "expired" });
      expect(s.readCanonicalState).not.toHaveBeenCalled();
      s.management.dispose();
    }
    const s = setup();
    const status = s.sent[0];
    s.socket.emit("otef_staff_remote_status_query", { type: "otef_staff_remote_status_query", table: "otef", sourceId: ids.source });
    refresh(s, status);
    expect(s.sent.at(-1)).toMatchObject({ result: "rejected", reason: "expired" });
    expect(s.readCanonicalState).not.toHaveBeenCalled();
    s.management.dispose();
  });

  it("allows the inclusive 10,000 ms lease edge", async () => {
    const s = setup();
    const status = s.sent[0];
    s.setTime(110_000, 20_000);
    refresh(s, status);
    await vi.waitFor(() => expect(s.reload).toHaveBeenCalledOnce());
    s.management.dispose();
  });

  it("rejects failed fresh reads and releases the check for a later deliberate request", async () => {
    const readCanonicalState = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(homeSnapshot());
    const s = setup({ readCanonicalState });
    const status = s.sent[0];
    refresh(s, status);
    await vi.waitFor(() => expect(s.sent.at(-1)).toMatchObject({ type: "otef_staff_remote_refresh_ack", reason: "state_unavailable" }));
    refresh(s, status);
    expect(readCanonicalState).toHaveBeenCalledTimes(1);
    refresh(s, status, "55555555-5555-4555-8555-555555555555");
    await vi.waitFor(() => expect(s.reload).toHaveBeenCalledOnce());
    expect(readCanonicalState).toHaveBeenCalledTimes(2);
    s.management.dispose();
  });

  it("times out, aborts its signal, and ignores its late result after a newer check begins", async () => {
    vi.useFakeTimers();
    const resolvers = [];
    const signals = [];
    const readCanonicalState = vi.fn(({ signal }) => new Promise((resolve) => { resolvers.push(resolve); signals.push(signal); }));
    const s = setup({ readCanonicalState });
    const status = s.sent[0];
    refresh(s, status);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(signals[0].aborted).toBe(true);
    expect(s.sent.at(-1)).toMatchObject({ type: "otef_staff_remote_refresh_ack", reason: "state_unavailable" });
    refresh(s, status);
    expect(readCanonicalState).toHaveBeenCalledTimes(1);
    refresh(s, status, "55555555-5555-4555-8555-555555555555");
    expect(readCanonicalState).toHaveBeenCalledTimes(2);
    resolvers[0](homeSnapshot());
    await Promise.resolve();
    expect(s.reload).not.toHaveBeenCalled();
    expect(s.sent.filter((m) => m.result === "accepted")).toHaveLength(0);
    resolvers[1](homeSnapshot());
    await vi.waitFor(() => expect(s.reload).toHaveBeenCalledOnce());
    expect(signals[1].aborted).toBe(false);
    s.management.dispose();
  });

  it("admits only one concurrent check and rechecks restrictions after the read", async () => {
    const resolveReads = [];
    let restriction = null;
    const readCanonicalState = vi.fn(() => new Promise((resolve) => { resolveReads.push(resolve); }));
    const s = setup({ readCanonicalState, getRefreshState: () => ({ ready: true, refreshBlockReason: restriction }) });
    const status = s.sent[0];
    refresh(s, status);
    refresh(s, status, "55555555-5555-4555-8555-555555555555");
    expect(s.sent.at(-1)).toMatchObject({ result: "rejected", reason: "busy" });
    restriction = "owned_session";
    resolveReads[0](homeSnapshot());
    await vi.waitFor(() => expect(s.sent.at(-1)).toMatchObject({ result: "rejected", reason: "owned_session" }));
    refresh(s, status, "55555555-5555-4555-8555-555555555555");
    expect(readCanonicalState).toHaveBeenCalledTimes(1);
    restriction = null;
    refresh(s, status, "66666666-6666-4666-8666-666666666666");
    expect(readCanonicalState).toHaveBeenCalledTimes(2);
    resolveReads[1](homeSnapshot());
    await vi.waitFor(() => expect(s.reload).toHaveBeenCalledOnce());
    s.management.dispose();
  });

  it("rejects storage and offline ACK failures without reload or queued retry", async () => {
    const s = setup();
    const status = s.sent[0];
    s.storage.setItem.mockImplementationOnce(() => { throw new Error("storage blocked"); });
    refresh(s, status);
    await vi.waitFor(() => expect(s.sent.at(-1)).toMatchObject({ result: "rejected", reason: "storage_unavailable" }));
    expect(s.reload).not.toHaveBeenCalled();
    s.management.dispose();

    const offline = setup({ sendResult: false });
    refresh(offline, offline.sent[0]);
    await vi.waitFor(() => expect(offline.storage.setItem).toHaveBeenCalled());
    expect(offline.reload).not.toHaveBeenCalled();
    expect([...offline.values.values()].some((value) => value.includes("schemaVersion"))).toBe(false);
    offline.management.dispose();

    const unavailable = setup({ storage: null });
    refresh(unavailable, unavailable.sent[0]);
    await vi.waitFor(() => expect(unavailable.sent.at(-1)).toMatchObject({ result: "rejected", reason: "storage_unavailable" }));
    expect(unavailable.reload).not.toHaveBeenCalled();
    unavailable.management.dispose();
  });

  it.each([
    ["corrupt", "{"],
    ["expired", JSON.stringify({ schemaVersion: 1, remoteId: ids.remote, sourceId: ids.source, requestId: ids.request, previousInstanceId: ids.instance, savedAtMs: 39_999 })],
  ])("discards %s receipt without changing normal startup", (_label, raw) => {
    const stored = new Map([["otef-staff-remote-reload-receipt", raw]]);
    const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) };
    const s = setup({ storage });
    expect(s.sent[0].reloadReceipt).toBeNull();
    expect(s.reload).not.toHaveBeenCalled();
    expect(stored.has("otef-staff-remote-reload-receipt")).toBe(false);
    s.management.dispose();
  });

  it("keeps a valid receipt for correlation only after a ready report, then clears it 60 seconds after Home success", () => {
    vi.useFakeTimers();
    const raw = JSON.stringify({ schemaVersion: 1, remoteId: ids.remote, sourceId: ids.source, requestId: ids.request,
      previousInstanceId: ids.instance, savedAtMs: 99_999 });
    const stored = new Map([["otef-staff-remote-reload-receipt", raw]]);
    const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) };
    let ready = false;
    const s = setup({ storage, getRefreshState: () => ({ ready, refreshBlockReason: ready ? null : "not_ready" }), buildId: "frontend-test" });
    expect(s.sent[0]).toMatchObject({ ready: false, reloadReceipt: null });
    ready = true;
    s.socket.emit("otef_staff_remote_status_query", { type: "otef_staff_remote_status_query", table: "otef", sourceId: ids.source });
    expect(s.sent.at(-1).reloadReceipt).toBeNull();
    s.management.noteHomeSuccess();
    s.socket.emit("otef_staff_remote_status_query", { type: "otef_staff_remote_status_query", table: "otef", sourceId: ids.source });
    expect(s.sent.at(-1)).toMatchObject({ ready: true, buildId: "frontend-test", reloadReceipt: { requestId: ids.request } });
    s.setTime(90_000, 70_000);
    vi.advanceTimersByTime(60_000);
    expect(s.sent.at(-1).reloadReceipt).toBeNull();
    expect(stored.has("otef-staff-remote-reload-receipt")).toBe(false);
    expect(s.reload).not.toHaveBeenCalled();
    s.management.dispose();
  });

  it("starts receipt retention at Home success while disconnected", () => {
    const raw = JSON.stringify({ schemaVersion: 1, remoteId: ids.remote, sourceId: ids.source, requestId: ids.request,
      previousInstanceId: ids.instance, savedAtMs: 99_999 });
    const stored = new Map([["otef-staff-remote-reload-receipt", raw]]);
    const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) };
    let ready = false;
    const s = setup({ storage, getRefreshState: () => ({ ready, refreshBlockReason: ready ? null : "not_ready" }) });
    s.socket.isConnected = false;
    s.management.noteHomeSuccess();
    s.setTime(160_000, 70_000);
    ready = true;
    s.socket.isConnected = true;
    s.socket.emit("connect");
    expect(s.sent.at(-1)).toMatchObject({ ready: true, reloadReceipt: null });
    expect(stored.has("otef-staff-remote-reload-receipt")).toBe(false);
    s.management.dispose();
  });
});
