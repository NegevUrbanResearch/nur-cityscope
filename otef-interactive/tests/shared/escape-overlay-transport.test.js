import { beforeEach, describe, expect, test, vi } from "vitest";

const IDLE_CLOCK = {
  phase: "idle",
  membership: [],
  beats: [],
  loop: false,
  positionMs: 0,
  anchorMs: null,
  seekKind: "none",
  revision: 8,
  serverNowMs: 50_000,
};

const EMPTY_PERSON = { personId: null, datasetVersion: null, revision: 3 };

const NOVA_SCENE = {
  sceneRevision: 3,
  narrativeState: { id: "nova", transition: "enter", revision: 3 },
  basemap: "satellite_bw",
  investigationClock: IDLE_CLOCK,
  personSelection: EMPTY_PERSON,
  escapeOverlay: { individual: true, overlap: false },
};

const NOVA_REST = {
  narrative_state: NOVA_SCENE.narrativeState,
  basemap: NOVA_SCENE.basemap,
  investigation_clock: NOVA_SCENE.investigationClock,
  person_selection: NOVA_SCENE.personSelection,
  escape_overlay: { individual: false, overlap: true },
};

function installWebSocketMock() {
  vi.doMock("../../frontend/src/shared/websocket-client.js", () => ({
    OTEFWebSocketClient: class {
      constructor(url, options) {
        this.url = url;
        this.options = options;
        this.listeners = new Map();
        this.disconnected = false;
      }
      on(type, callback) {
        this.listeners.set(type, callback);
      }
      connect() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  }));
}

describe("escape overlay transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
  });

  test("publishes the overlay WebSocket message type", async () => {
    const { OTEF_MESSAGE_TYPES } = await import("../../frontend/src/shared/message-protocol.js");
    expect(OTEF_MESSAGE_TYPES.ESCAPE_OVERLAY_CHANGED).toBe("otef_escape_overlay_changed");
  });

  test("API helper sends set_escape_overlay without a narrative action", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");

    await OTEF_API.setEscapeOverlay("otef", { individual: false, overlap: true }, {
      sourceId: "remote-a",
      timestamp: 10,
    });

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      action: "set_escape_overlay",
      individual: false,
      overlap: true,
      sourceId: "remote-a",
      timestamp: 10,
    });
  });

  test("GET hydrate adopts escape_overlay without changing narrative revision handling", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    vi.spyOn(context, "_setupWebSocket").mockImplementation(() => {});
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({
      ...NOVA_REST,
      layerGroups: [{ id: "nli", name: "NLI", layers: [] }],
    });

    await context.init("otef");

    expect(context.getNarrativeState()).toMatchObject({ id: "nova", revision: 3 });
    expect(context.getNarrativeState()).not.toHaveProperty("escapeOverlay");
    expect(context.getEscapeOverlay()).toEqual({ individual: false, overlap: true });
  });

  test("REST snapshot missing escape_overlay still hydrates a normalized overlay", async () => {
    const { applyStateFromApi } = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");

    applyStateFromApi(context, {
      narrative_state: NOVA_SCENE.narrativeState,
      basemap: NOVA_SCENE.basemap,
      investigation_clock: NOVA_SCENE.investigationClock,
      person_selection: NOVA_SCENE.personSelection,
    }, { notify: false });

    expect(context.getNarrativeState()).toMatchObject({ id: "nova", revision: 3 });
    expect(context.getNarrativeState()).not.toHaveProperty("escapeOverlay");
    expect(context.getEscapeOverlay()).toEqual({ individual: false, overlap: false });
  });

  test("setEscapeOverlay PATCHes without set_narrative and notifies escapeOverlay", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    vi.spyOn(context, "_setupWebSocket").mockImplementation(() => {});
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue(NOVA_REST);
    await context.init("otef");

    const seen = [];
    context.subscribe("escapeOverlay", (value) => seen.push(value));
    vi.spyOn(api.OTEF_API, "executeCommand").mockResolvedValue({
      status: "ok",
      action: "set_escape_overlay",
      escapeOverlay: { individual: false, overlap: true },
    });

    await context.setEscapeOverlay({ individual: false, overlap: true });

    expect(api.OTEF_API.executeCommand).toHaveBeenCalledWith("otef", expect.objectContaining({
      action: "set_escape_overlay",
      individual: false,
      overlap: true,
    }));
    expect(context.getNarrativeState().revision).toBe(3);
    expect(context.getNarrativeState()).not.toHaveProperty("escapeOverlay");
    expect(context.getEscapeOverlay()).toEqual({ individual: false, overlap: true });
    expect(seen.at(-1)).toEqual({ individual: false, overlap: true });
  });

  test("otef_escape_overlay_changed updates overlay only", async () => {
    installWebSocketMock();
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    expect(context._applyNarrativeScene(NOVA_SCENE)).toBe(true);
    websocket.setupWebSocket(context);
    const handler = context._wsClient.listeners.get("otef_escape_overlay_changed");

    handler({
      table: "otef",
      escapeOverlay: { individual: false, overlap: true },
      sourceId: "remote-a",
      timestamp: 123,
    });

    expect(context.getEscapeOverlay()).toEqual({ individual: false, overlap: true });
    expect(context.getNarrativeState()).toEqual(NOVA_SCENE.narrativeState);
    expect(context.getNarrativeState()).not.toHaveProperty("escapeOverlay");
  });

  test("scene without escapeOverlay is rejected", async () => {
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    expect(context._applyNarrativeScene({
      sceneRevision: 4,
      narrativeState: { id: "nova", transition: "enter", revision: 4 },
      basemap: "satellite_bw",
      investigationClock: IDLE_CLOCK,
      personSelection: EMPTY_PERSON,
    })).toBe(false);
    expect(context.getNarrativeState().revision).toBe(0);
    expect(context.getEscapeOverlay()).toEqual({ individual: false, overlap: false });
  });
});
