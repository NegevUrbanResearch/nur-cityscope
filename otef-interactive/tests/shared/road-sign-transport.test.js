import { beforeEach, describe, expect, test, vi } from "vitest";

describe("Road 232 sign transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "ok" }) });
  });

  function installWebSocketMock() {
    vi.doMock("../../frontend/src/shared/websocket-client.js", () => ({
      OTEFWebSocketClient: class {
        constructor() { this.listeners = new Map(); }
        on(type, callback) { this.listeners.set(type, callback); }
        connect() {}
        disconnect() {}
      },
    }));
  }

  test("API helper sends the revisioned signs command and transport metadata", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    const settings = { version: 1, outputs: { left: [], right: [] } };
    await OTEF_API.setRoadSigns("otef", settings, { baseRevision: 4, sourceId: "source-a", timestamp: "2026-10-08T00:00:00.000Z" });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      action: "set_road_signs", settings, baseRevision: 4,
      sourceId: "source-a", timestamp: "2026-10-08T00:00:00.000Z",
    });
    expect(String(global.fetch.mock.calls[0][0])).toContain("/otef/command/");
  });

  test("context hydrates road signs, publishes the topic and ignores another table", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const empty = { version: 1, outputs: { left: [], right: [] } };
    vi.spyOn(context, "_setupWebSocket").mockImplementation(() => {});
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({ road_sign_settings: {}, road_sign_revision: 0, layerGroups: [] });
    const listener = vi.fn();
    context.subscribe("roadSigns", listener);
    await context.init("otef");
    expect(context.getRoadSigns()).toEqual({ settings: empty, revision: 0, error: null });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ settings: empty, revision: 0, error: null }));
    context._applyRoadSignsVersioned({ version: 1, outputs: { left: [], right: [] } }, 3, { table: "other" });
    expect(context.getRoadSigns()).toEqual({ settings: empty, revision: 0, error: null });
  });

  test("accepts revisioned WebSocket state monotonically and force refreshes same-revision mismatches", async () => {
    installWebSocketMock();
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const initial = { version: 1, outputs: { left: [], right: [] } };
    const newer = { version: 1, outputs: { left: [], right: [{ id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } }] } };
    const getState = vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({ road_sign_settings: initial, road_sign_revision: 2 });
    context._tableName = "otef";
    context._roadSignRevision = -1;
    websocket.applyStateFromApi(context, { road_sign_settings: initial, road_sign_revision: 1 });
    websocket.setupWebSocket(context);
    context._wsClient.listeners.get("otef_road_signs_changed")({ table: "other", roadSignSettings: newer, roadSignRevision: 2 });
    expect(context.getRoadSigns().settings).toEqual(initial);
    context._wsClient.listeners.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: newer, roadSignRevision: 2 });
    expect(context.getRoadSigns().settings).toEqual(newer);
    context._wsClient.listeners.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: initial, roadSignRevision: 1 });
    expect(context.getRoadSigns().settings).toEqual(newer);
    context._applyRoadSignsVersioned(initial, 2);
    await vi.waitFor(() => expect(getState).toHaveBeenCalledWith("otef", { forceFresh: true }));
  });

  test("clears a revision mismatch error when the fresh snapshot confirms the accepted document", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const accepted = { version: 1, outputs: { left: [], right: [] } };
    const getState = vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({ road_sign_settings: accepted, road_sign_revision: 1 });
    context._tableName = "otef";
    context._roadSignSettings = accepted;
    context._roadSignRevision = 1;
    context._applyRoadSignsVersioned({ version: 1, outputs: { left: [], right: [{ id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } }] } }, 1);
    expect(context.getRoadSigns().error).toBeTruthy();
    await vi.waitFor(() => expect(getState).toHaveBeenCalledWith("otef", { forceFresh: true }));
    await vi.waitFor(() => expect(context.getRoadSigns().error).toBeNull());
  });
});
