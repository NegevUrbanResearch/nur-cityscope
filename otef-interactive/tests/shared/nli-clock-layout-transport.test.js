import { beforeEach, describe, expect, test, vi } from "vitest";

const LAYOUT = {
  gis: {
    start: { leftPct: 10, topPct: 80, widthPct: 20, heightPct: 8, fontPx: 22, rotateDeg: 0 },
  },
  projection: {
    left: { leftPct: 40, topPct: 20, widthPct: 10, heightPct: 8, fontPx: 40, rotateDeg: 90 },
  },
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

describe("nli clock layout transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
  });

  test("publishes the clock-layout WebSocket message type", async () => {
    const { OTEF_MESSAGE_TYPES } = await import("../../frontend/src/shared/message-protocol.js");
    expect(OTEF_MESSAGE_TYPES.NLI_CLOCK_LAYOUT_CHANGED).toBe("otef_nli_clock_layout_changed");
  });

  test("API helper sends set_nli_clock_layout", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    await OTEF_API.setNliClockLayout("otef", "projection", "left", LAYOUT.projection.left, {
      baseRevision: 4,
      sourceId: "proj-a",
      timestamp: 10,
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      action: "set_nli_clock_layout",
      surface: "projection",
      slot: "left",
      layout: LAYOUT.projection.left,
      baseRevision: 4,
      sourceId: "proj-a",
      timestamp: 10,
    });
  });

  test("API helper sends a legend slot placement with its layout revision", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    const placement = { leftPct: 12, topPct: 34 };
    await OTEF_API.setLegendSettings("otef", { span: "left", layout: placement }, { baseRevision: 8 });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      action: "set_legend_settings", span: "left", layout: placement, baseRevision: 8,
    });
  });

  test("GET hydrate adopts nli_clock_layout", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    vi.spyOn(context, "_setupWebSocket").mockImplementation(() => {});
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({
      nli_clock_layout: LAYOUT,
      layerGroups: [],
    });
    await context.init("otef");
    expect(context.getNliClockLayout().projection.left.fontPx).toBe(40);
    expect(context.getNliClockLayout().gis.start.leftPct).toBe(10);
  });

  test("otef_nli_clock_layout_changed updates both surfaces", async () => {
    installWebSocketMock();
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    websocket.setupWebSocket(context);
    const handler = context._wsClient.listeners.get("otef_nli_clock_layout_changed");
    handler({
      table: "otef",
      nliClockLayout: LAYOUT,
      sourceId: "remote-a",
    });
    expect(context.getNliClockLayout().projection.left.fontPx).toBe(40);
  });

  test("newer WebSocket layouts survive a delayed older GET snapshot", async () => {
    installWebSocketMock();
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    websocket.applyStateFromApi(context, {
      nli_clock_layout: LAYOUT, nli_clock_layout_revision: 5,
      legend_settings: { language: "he", projection: { left: { leftPct: 10 } }, summarizedGroupIds: [] },
      legend_layout_revision: 5,
    });
    websocket.setupWebSocket(context);
    const newerClock = structuredClone(LAYOUT);
    newerClock.gis.start.leftPct = 33;
    context._wsClient.listeners.get("otef_nli_clock_layout_changed")({
      table: "otef", nliClockLayout: newerClock, nliClockLayoutRevision: 6,
    });
    context._wsClient.listeners.get("otef_legend_settings_changed")({
      table: "otef", changeKind: "layout", legendProjection: { left: { leftPct: 60 } }, legendLayoutRevision: 6,
    });
    websocket.applyStateFromApi(context, {
      nli_clock_layout: LAYOUT, nli_clock_layout_revision: 5,
      legend_settings: { language: "en", projection: { left: { leftPct: 20 } }, summarizedGroupIds: ["new"] },
      legend_layout_revision: 5,
    });
    expect(context.getNliClockLayout().gis.start.leftPct).toBe(33);
    expect(context.getLegendSettings()).toMatchObject({ language: "en", projection: { left: { leftPct: 60 } } });
  });

  test("fresh GET reconciles a same-revision context mismatch exactly once", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    websocket.applyStateFromApi(context, { nli_clock_layout: LAYOUT, nli_clock_layout_revision: 5 });
    const authoritative = structuredClone(LAYOUT);
    authoritative.gis.start.leftPct = 48;
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({
      nli_clock_layout: authoritative, nli_clock_layout_revision: 5,
    });
    const mismatched = structuredClone(LAYOUT);
    mismatched.gis.start.leftPct = 37;
    context._applyNliClockLayoutVersioned(mismatched, 5);
    await vi.waitFor(() => expect(context.getNliClockLayout().gis.start.leftPct).toBe(48));
    expect(api.OTEF_API.getState).toHaveBeenCalledTimes(1);
    expect(api.OTEF_API.getState).toHaveBeenCalledWith("otef", { forceFresh: true });
  });
});
