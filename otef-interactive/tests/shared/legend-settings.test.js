import { beforeEach, describe, expect, test, vi } from "vitest";

const SETTINGS = { language: "en", projection: { left: { leftPct: 10 } }, summarizedGroupIds: [] };

describe("shared legend settings transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ legendSettings: SETTINGS }) });
  });

  test("publishes message type and sends exactly one settings command", async () => {
    const { OTEF_MESSAGE_TYPES } = await import("../../frontend/src/shared/message-protocol.js");
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    expect(OTEF_MESSAGE_TYPES.LEGEND_SETTINGS_CHANGED).toBe("otef_legend_settings_changed");
    await OTEF_API.setLegendSettings("otef", { language: "en" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ action: "set_legend_settings", language: "en" });
  });

  test("GET hydration notifies legend subscribers without posting", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    vi.spyOn(context, "_setupWebSocket").mockImplementation(() => {});
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({ legend_settings: SETTINGS, layerGroups: [] });
    const seen = [];
    context.subscribe("legendSettings", (value) => seen.push(value));
    await context.init("otef");
    expect(context.getLegendSettings()).toEqual(SETTINGS);
    expect(seen.at(-1)).toEqual(SETTINGS);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("reconnect GET hydrates legend settings without posting", async () => {
    vi.doMock("../../frontend/src/shared/websocket-client.js", () => ({ OTEFWebSocketClient: class {
      constructor(url, options) { this.options = options; this.listeners = new Map(); }
      on(type, callback) { this.listeners.set(type, callback); }
      connect() {}
    } }));
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({ legend_settings: SETTINGS, layerGroups: [] });
    const seen = [];
    context.subscribe("legendSettings", (value) => seen.push(value));
    websocket.setupWebSocket(context);

    await context._wsClient.options.onConnect();
    context._wsClient.options.onDisconnect();
    await context._wsClient.options.onConnect();

    expect(api.OTEF_API.getState).toHaveBeenCalledWith("otef", { forceFresh: true });
    expect(context.getLegendSettings()).toEqual(SETTINGS);
    expect(seen.at(-1)).toEqual(SETTINGS);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("websocket event routes to legend subscribers", async () => {
    vi.doMock("../../frontend/src/shared/websocket-client.js", () => ({ OTEFWebSocketClient: class {
      constructor() { this.listeners = new Map(); }
      on(type, callback) { this.listeners.set(type, callback); }
      connect() {}
    } }));
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const seen = [];
    context.subscribe("legendSettings", (value) => seen.push(value));
    websocket.setupWebSocket(context);
    context._wsClient.listeners.get("otef_legend_settings_changed")({ legendSettings: SETTINGS });
    expect(seen.at(-1)).toEqual(SETTINGS);
  });

  test("websocket event ignores legend settings for another table", async () => {
    vi.doMock("../../frontend/src/shared/websocket-client.js", () => ({ OTEFWebSocketClient: class {
      constructor() { this.listeners = new Map(); }
      on(type, callback) { this.listeners.set(type, callback); }
      connect() {}
    } }));
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const seen = [];
    context.subscribe("legendSettings", (value) => seen.push(value));
    websocket.setupWebSocket(context);
    const seenBeforeForeignEvent = seen.slice();
    context._wsClient.listeners.get("otef_legend_settings_changed")({
      table: "another-table",
      legendSettings: SETTINGS,
    });
    expect(seen).toEqual(seenBeforeForeignEvent);
  });
});
