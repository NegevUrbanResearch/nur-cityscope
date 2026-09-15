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
    await OTEF_API.setNliClockLayout("otef", "projection", LAYOUT.projection, {
      sourceId: "proj-a",
      timestamp: 10,
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      action: "set_nli_clock_layout",
      surface: "projection",
      layout: LAYOUT.projection,
      sourceId: "proj-a",
      timestamp: 10,
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
});
