import { beforeEach, describe, expect, test, vi } from "vitest";

const SETTINGS = {
  baseline: {
    captureId: "fixture-settlement-name",
    captureDigest: "a".repeat(64),
    sourceDigest: "b".repeat(64),
    catalogDigest: "c".repeat(64),
    predecessor: { revision: 749, configDigest: "d".repeat(64) },
    successor: { revision: 750, configDigest: "e".repeat(64) },
    outputs: {
      left: { "0067": { x: 510, y: 350 }, "0424": { x: -40, y: 1400 } },
      right: { "0067": { x: 1200, y: 350 }, "0424": { x: 3000, y: -20 } },
    },
  },
  style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
  outputs: { left: {}, right: {} },
};

function installWebSocketMock() {
  vi.doMock("../../frontend/src/shared/websocket-client.js", () => ({
    OTEFWebSocketClient: class {
      constructor(url, options) {
        this.url = url;
        this.options = options;
        this.listeners = new Map();
      }
      on(type, callback) {
        this.listeners.set(type, callback);
      }
      connect() {}
      disconnect() {}
    },
  }));
}

describe("settlement name transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
  });

  test("publishes the settlement-name WebSocket message type", async () => {
    const { OTEF_MESSAGE_TYPES } = await import("../../frontend/src/shared/message-protocol.js");
    expect(OTEF_MESSAGE_TYPES.SETTLEMENT_NAMES_CHANGED).toBe("otef_settlement_names_changed");
  });

  test("API helper sends set_settlement_names with the operation fields", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    const sourceId = "11111111-1111-4111-8111-111111111111";
    await OTEF_API.setSettlementNames("otef", {
      operation: "position",
      output: "left",
      citycode: "0067",
      position: { x: 510, y: 350 },
      baseRevision: 1,
    }, { sourceId, timestamp: "2026-09-29T00:00:00.000Z" });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      action: "set_settlement_names",
      operation: "position",
      output: "left",
      citycode: "0067",
      position: { x: 510, y: 350 },
      baseRevision: 1,
      sourceId,
      timestamp: "2026-09-29T00:00:00.000Z",
    });
    expect(String(global.fetch.mock.calls[0][0])).toContain("/otef/command/");
  });

  test("API helper fills sourceId and timestamp when meta omits them", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    await OTEF_API.setSettlementNames("otef", {
      operation: "reset_position",
      output: "left",
      citycode: "0067",
      baseRevision: 2,
    });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      action: "set_settlement_names",
      operation: "reset_position",
      output: "left",
      citycode: "0067",
      baseRevision: 2,
    });
    expect(body.sourceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(typeof body.timestamp).toBe("string");
    expect(body.timestamp.length).toBeGreaterThan(0);
    expect(body.position).toBeUndefined();
  });

  test("API helper sends initialize_projection_name_settings with the supplied body", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    await OTEF_API.initializeProjectionNameSettings("otef", {
      sourceId: "11111111-1111-4111-8111-111111111111",
      captureId: "fixture-settlement-name",
      baseRevision: 0,
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      action: "initialize_projection_name_settings",
      sourceId: "11111111-1111-4111-8111-111111111111",
      captureId: "fixture-settlement-name",
      baseRevision: 0,
    });
  });

  test("preserves parsed conflict details on HTTP 409", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "conflict",
        settlementNameSettings: SETTINGS,
        settlementNameRevision: 4,
      }),
    });
    await expect(OTEF_API.setSettlementNames("otef", {
      operation: "style",
      style: SETTINGS.style,
      baseRevision: 3,
    }, { sourceId: "11111111-1111-4111-8111-111111111111", timestamp: "t" })).rejects.toMatchObject({
      status: 409,
      details: { error: "conflict", settlementNameRevision: 4 },
    });
  });

  test("GET hydrate adopts settlement_name_settings and notifies subscribers", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    vi.spyOn(context, "_setupWebSocket").mockImplementation(() => {});
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({
      settlement_name_settings: SETTINGS,
      settlement_name_revision: 2,
      layerGroups: [],
    });
    const listener = vi.fn();
    context.subscribe("settlementNames", listener);
    await context.init("otef");
    expect(context.getSettlementNameSettings().style.fontPx).toBe(14);
    expect(context.getSettlementNameSettings().outputs.left["0067"]).toBeUndefined();
    expect(context.getSettlementNameRevision()).toBe(2);
    expect(listener).toHaveBeenCalled();
  });

  test("otef_settlement_names_changed updates camelCase settings and ignores another table", async () => {
    installWebSocketMock();
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._settlementNameRevision = -1;
    context._settlementNameSettings = null;
    websocket.setupWebSocket(context);
    const handler = context._wsClient.listeners.get("otef_settlement_names_changed");
    handler({
      table: "another",
      settlementNameSettings: { ...SETTINGS, style: { ...SETTINGS.style, fontPx: 40 } },
      settlementNameRevision: 9,
    });
    expect(context.getSettlementNameRevision()).not.toBe(9);
    handler({
      table: "otef",
      settlementNameSettings: SETTINGS,
      settlementNameRevision: 2,
      sourceId: "remote-a",
    });
    expect(context.getSettlementNameSettings().style.fontPx).toBe(14);
    expect(context.getSettlementNameRevision()).toBe(2);
  });

  test("newer WebSocket settings survive a delayed older GET snapshot", async () => {
    installWebSocketMock();
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    websocket.applyStateFromApi(context, {
      settlement_name_settings: SETTINGS,
      settlement_name_revision: 5,
    });
    websocket.setupWebSocket(context);
    const newer = structuredClone(SETTINGS);
    newer.outputs.left["0067"] = { x: 33, y: 40 };
    context._wsClient.listeners.get("otef_settlement_names_changed")({
      table: "otef",
      settlementNameSettings: newer,
      settlementNameRevision: 6,
    });
    websocket.applyStateFromApi(context, {
      settlement_name_settings: SETTINGS,
      settlement_name_revision: 5,
    });
    expect(context.getSettlementNameSettings().outputs.left["0067"]).toEqual({ x: 33, y: 40 });
    expect(context.getSettlementNameRevision()).toBe(6);
  });

  test("fresh GET reconciles a same-revision context mismatch exactly once", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    websocket.applyStateFromApi(context, {
      settlement_name_settings: SETTINGS,
      settlement_name_revision: 5,
    });
    const authoritative = structuredClone(SETTINGS);
    authoritative.style = { ...SETTINGS.style, fontPx: 16 };
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({
      settlement_name_settings: authoritative,
      settlement_name_revision: 5,
    });
    const mismatched = structuredClone(SETTINGS);
    mismatched.style = { ...SETTINGS.style, fontPx: 20 };
    context._applySettlementNamesVersioned(mismatched, 5);
    await vi.waitFor(() => expect(context.getSettlementNameSettings().style.fontPx).toBe(16));
    expect(api.OTEF_API.getState).toHaveBeenCalledTimes(1);
    expect(api.OTEF_API.getState).toHaveBeenCalledWith("otef", { forceFresh: true });
  });

  test("an invalid snapshot keeps the last accepted document, refreshes once, and invents no offsets", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const seen = [];
    context.subscribe("settlementNames", (value) => seen.push(value));
    websocket.applyStateFromApi(context, {
      settlement_name_settings: SETTINGS,
      settlement_name_revision: 2,
    });
    const bad = structuredClone(SETTINGS);
    bad.style = { ...SETTINGS.style, fontPx: true };
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({
      settlement_name_settings: bad,
      settlement_name_revision: 3,
    });
    websocket.applyStateFromApi(context, {
      settlement_name_settings: bad,
      settlement_name_revision: 3,
    });
    await vi.waitFor(() => expect(api.OTEF_API.getState).toHaveBeenCalledTimes(1));
    expect(api.OTEF_API.getState).toHaveBeenCalledWith("otef", { forceFresh: true });
    expect(context.getSettlementNameRevision()).toBe(2);
    expect(context.getSettlementNameSettings().style.fontPx).toBe(14);
    expect(context.getSettlementNameSettings().outputs.left["0067"]).toBeUndefined();
    expect(seen.at(-1).error).toBeTruthy();
    expect(api.OTEF_API.getState).toHaveBeenCalledTimes(1);
  });

  test("an empty document reports initialization required without refreshing", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const seen = [];
    context.subscribe("settlementNames", (value) => seen.push(value));
    const getState = vi.spyOn(api.OTEF_API, "getState");
    websocket.applyStateFromApi(context, {
      settlement_name_settings: {},
      settlement_name_revision: 0,
    });
    expect(context.getSettlementNameSettings()).toBeNull();
    expect(context.getSettlementNameRevision()).toBe(0);
    expect(seen.at(-1).error).toMatch(/Initialization required/);
    expect(getState).not.toHaveBeenCalled();
  });
});
