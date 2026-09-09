import { beforeEach, describe, expect, test, vi } from "vitest";

const ACTIVE_SCENE = {
  sceneRevision: 4,
  narrativeState: { id: "segev", transition: "enter", revision: 4 },
  basemap: "satellite_bw",
  investigationClock: {
    phase: "idle",
    membership: [],
    beats: [],
    loop: false,
    positionMs: 0,
    anchorMs: null,
    seekKind: "none",
    revision: 8,
    serverNowMs: 50_000,
  },
  personSelection: { personId: null, datasetVersion: null, revision: 3 },
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

describe("narrative state transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
  });

  test("publishes the three narrative WebSocket message types", async () => {
    const { OTEF_MESSAGE_TYPES } = await import("../../frontend/src/shared/message-protocol.js");
    expect(OTEF_MESSAGE_TYPES).toMatchObject({
      NARRATIVE_SCENE_CHANGED: "otef_narrative_scene_changed",
      NARRATIVE_PRESENTATION_COMMAND: "otef_narrative_presentation_command",
      NARRATIVE_PRESENTATION_RESULT: "otef_narrative_presentation_result",
    });
  });

  test("API helpers send exact transition and ephemeral presentation commands", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");

    await OTEF_API.setNarrative("otef", "segev", 3, { sourceId: "remote-a", timestamp: 10 });
    await OTEF_API.narrativePresentationCommand("otef", {
      presentationAction: "open",
      narrativeId: "segev",
      requestId: "request-1",
      sourceId: "remote-a",
      timestamp: 11,
    });
    await OTEF_API.narrativePresentationResult("otef", {
      outcome: "opened",
      narrativeId: "segev",
      requestId: "request-1",
      sourceId: "gis-a",
      timestamp: 12,
    });

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      action: "set_narrative",
      narrativeId: "segev",
      expectedRevision: 3,
      sourceId: "remote-a",
      timestamp: 10,
    });
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
      action: "narrative_presentation",
      presentationAction: "open",
      narrativeId: "segev",
      requestId: "request-1",
      sourceId: "remote-a",
      timestamp: 11,
    });
    expect(JSON.parse(global.fetch.mock.calls[2][1].body)).toEqual({
      action: "narrative_presentation_result",
      outcome: "opened",
      narrativeId: "segev",
      requestId: "request-1",
      sourceId: "gis-a",
      timestamp: 12,
    });
  });

  test("exposes the inactive state and cleans up narrative subscriptions", async () => {
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const listener = vi.fn();

    expect(context.getNarrativeState()).toEqual({ id: null, transition: "initial", revision: 0 });
    const dispose = context.subscribe("narrativeState", listener);
    expect(listener).toHaveBeenCalledWith({ id: null, transition: "initial", revision: 0 });
    dispose();
    context._applyNarrativeScene(ACTIVE_SCENE);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("setNarrative uses the current revision without optimistic mutation", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    vi.spyOn(api.OTEF_API, "executeCommand").mockResolvedValue({ status: "ok" });

    await context.setNarrative("segev");

    expect(api.OTEF_API.executeCommand).toHaveBeenCalledWith("otef", {
      action: "set_narrative",
      narrativeId: "segev",
      expectedRevision: context.getNarrativeState().revision,
      sourceId: expect.any(String),
      timestamp: expect.any(Number),
    });
    expect(context.getNarrativeState()).toEqual({ id: null, transition: "initial", revision: 0 });
  });

  test("the initiating command response atomically hydrates every coupled getter", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const observations = [];
    for (const key of ["narrativeState", "basemap", "investigationClock", "personSelection"]) {
      context.subscribe(key, () => {
        if (context.getNarrativeState().revision === 4) {
          observations.push({
            narrative: context.getNarrativeState(),
            basemap: context.getBasemap(),
            clock: context.getInvestigationClock(),
            person: context.getPersonSelection(),
          });
        }
      });
    }
    vi.spyOn(api.OTEF_API, "executeCommand").mockResolvedValue({
      status: "ok",
      action: "set_narrative",
      scene: ACTIVE_SCENE,
    });

    await context.setNarrative("segev");

    expect(observations).toHaveLength(4);
    for (const observation of observations) {
      expect(observation).toMatchObject({
        narrative: ACTIVE_SCENE.narrativeState,
        basemap: "satellite_bw",
        clock: { phase: "idle", revision: 8 },
        person: { personId: null, datasetVersion: null, revision: 3 },
      });
    }
  });

  test("REST bootstrap installs normalized narrative state and trusted coupled values", async () => {
    const { applyStateFromApi } = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");

    applyStateFromApi(context, {
      narrative_state: ACTIVE_SCENE.narrativeState,
      basemap: ACTIVE_SCENE.basemap,
      investigation_clock: ACTIVE_SCENE.investigationClock,
      person_selection: ACTIVE_SCENE.personSelection,
    }, { notify: false });

    expect(context.getNarrativeState()).toEqual(ACTIVE_SCENE.narrativeState);
    expect(context.getBasemap()).toBe("satellite_bw");
    expect(context.getInvestigationClock()).toMatchObject({ phase: "idle", revision: 8 });
    expect(context.getPersonSelection()).toEqual(ACTIVE_SCENE.personSelection);
  });

  test("initial hydration notifies controllers that subscribed before the REST state arrived", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    vi.spyOn(context, "_setupWebSocket").mockImplementation(() => {});
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({
      narrative_state: ACTIVE_SCENE.narrativeState,
      basemap: ACTIVE_SCENE.basemap,
      investigation_clock: ACTIVE_SCENE.investigationClock,
      person_selection: ACTIVE_SCENE.personSelection,
      layerGroups: [{ id: "nli", name: "NLI", layers: [] }],
    });
    const listener = vi.fn();
    context.subscribe("narrativeState", listener);

    await context.init("otef");

    expect(listener).toHaveBeenLastCalledWith(ACTIVE_SCENE.narrativeState);
    expect(listener.mock.calls.at(-1)[0].id).toBe("segev");
  });

  test("scene WebSocket ignores same-source echoes, stale revisions, and untrusted scene fields", async () => {
    installWebSocketMock();
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    websocket.setupWebSocket(context);
    const handler = context._wsClient.listeners.get("otef_narrative_scene_changed");

    handler({ table: "otef", sourceId: context._clientId, scene: ACTIVE_SCENE });
    expect(context.getNarrativeState().revision).toBe(0);

    handler({
      table: "otef",
      sourceId: "remote-a",
      scene: {
        ...ACTIVE_SCENE,
        center: [0, 0],
        presentationUrl: "https://attacker.invalid/embed",
        narrativeState: {
          ...ACTIVE_SCENE.narrativeState,
          center: [0, 0],
          presentationUrl: "https://attacker.invalid/embed",
        },
      },
    });
    expect(context.getNarrativeState()).toEqual(ACTIVE_SCENE.narrativeState);

    handler({
      table: "otef",
      sourceId: "remote-b",
      scene: {
        ...ACTIVE_SCENE,
        sceneRevision: 3,
        narrativeState: { id: null, transition: "exit", revision: 3 },
        basemap: "dark",
      },
    });
    expect(context.getNarrativeState()).toEqual(ACTIVE_SCENE.narrativeState);
    expect(context.getBasemap()).toBe("satellite_bw");
  });

  test("rejects a scene whose envelope revision disagrees with its narrative revision", async () => {
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    expect(context._applyNarrativeScene({ ...ACTIVE_SCENE, sceneRevision: 9 })).toBe(false);
    expect(context.getNarrativeState().revision).toBe(0);
  });

  test("a newer narrative scene cannot regress newer coupled clock or person revisions", async () => {
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._setInvestigationClock({ ...ACTIVE_SCENE.investigationClock, revision: 10 });
    context._setPersonSelection({ personId: "p-new", datasetVersion: "v-new", revision: 5 });
    const observations = [];
    context.subscribe("narrativeState", () => {
      if (context.getNarrativeState().revision === 4) {
        observations.push({
          basemap: context.getBasemap(),
          clock: context.getInvestigationClock(),
          person: context.getPersonSelection(),
        });
      }
    });

    context._applyNarrativeScene(ACTIVE_SCENE);

    expect(context.getNarrativeState()).toEqual(ACTIVE_SCENE.narrativeState);
    expect(context.getBasemap()).toBe("satellite_bw");
    expect(context.getInvestigationClock()).toMatchObject({ revision: 10 });
    expect(context.getPersonSelection()).toEqual({
      personId: "p-new",
      datasetVersion: "v-new",
      revision: 5,
    });
    expect(observations).toEqual([{
      basemap: "satellite_bw",
      clock: expect.objectContaining({ revision: 10 }),
      person: { personId: "p-new", datasetVersion: "v-new", revision: 5 },
    }]);
  });

  test("reconnect fetches and atomically applies a fresh snapshot", async () => {
    installWebSocketMock();
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({
      narrative_state: ACTIVE_SCENE.narrativeState,
      basemap: ACTIVE_SCENE.basemap,
      investigation_clock: ACTIVE_SCENE.investigationClock,
      person_selection: ACTIVE_SCENE.personSelection,
    });
    websocket.setupWebSocket(context);

    await context._wsClient.options.onConnect();
    context._wsClient.options.onDisconnect();
    await context._wsClient.options.onConnect();

    expect(api.OTEF_API.getState).toHaveBeenCalledWith("otef", { forceFresh: true });
    expect(context.getNarrativeState()).toEqual(ACTIVE_SCENE.narrativeState);
    expect(context.getBasemap()).toBe("satellite_bw");
  });

  test("equal-revision reconnect cannot regress coupled state changed while the REST request is in flight", async () => {
    installWebSocketMock();
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._applyNarrativeScene(ACTIVE_SCENE);
    websocket.setupWebSocket(context);
    await context._wsClient.options.onConnect();

    let resolveSnapshot;
    vi.spyOn(api.OTEF_API, "getState").mockImplementation(() => new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));
    const reconnect = context._wsClient.options.onConnect();
    await vi.waitFor(() => expect(api.OTEF_API.getState).toHaveBeenCalledTimes(1));

    context._setConfirmedBasemap("dark");
    context._setInvestigationClock({ ...ACTIVE_SCENE.investigationClock, revision: 9 });
    context._setPersonSelection({ personId: "p-new", datasetVersion: "v-new", revision: 5 });
    const observations = [];
    for (const key of ["narrativeState", "basemap", "investigationClock", "personSelection"]) {
      context.subscribe(key, () => {
        observations.push({
          narrative: context.getNarrativeState(),
          basemap: context.getBasemap(),
          clock: context.getInvestigationClock(),
          person: context.getPersonSelection(),
        });
      });
    }
    observations.length = 0;

    resolveSnapshot({
      narrative_state: ACTIVE_SCENE.narrativeState,
      basemap: "osm",
      investigation_clock: ACTIVE_SCENE.investigationClock,
      person_selection: ACTIVE_SCENE.personSelection,
    });
    await reconnect;

    expect(context.getNarrativeState()).toEqual(ACTIVE_SCENE.narrativeState);
    expect(context.getBasemap()).toBe("dark");
    expect(context.getInvestigationClock()).toMatchObject({ revision: 9 });
    expect(context.getPersonSelection()).toEqual({
      personId: "p-new",
      datasetVersion: "v-new",
      revision: 5,
    });
    expect(observations).toEqual([]);
  });

  test("advancing reconnect scene preserves a newer intervening basemap WebSocket update", async () => {
    installWebSocketMock();
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._applyNarrativeScene({
      ...ACTIVE_SCENE,
      sceneRevision: 2,
      narrativeState: { id: null, transition: "exit", revision: 2 },
      basemap: "dark",
    });
    websocket.setupWebSocket(context);
    await context._wsClient.options.onConnect();
    let resolveSnapshot;
    vi.spyOn(api.OTEF_API, "getState").mockImplementation(() => new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));

    const reconnect = context._wsClient.options.onConnect();
    await vi.waitFor(() => expect(api.OTEF_API.getState).toHaveBeenCalledTimes(1));
    await context._wsClient.listeners.get("otef_basemap_changed")({
      table: "otef",
      basemap: "osm",
      sourceId: "remote-newer",
    });
    resolveSnapshot({
      narrative_state: { id: null, transition: "exit", revision: 4 },
      basemap: "dark",
      investigation_clock: { ...ACTIVE_SCENE.investigationClock, revision: 10 },
      person_selection: { personId: null, datasetVersion: null, revision: 4 },
    });
    await reconnect;

    expect(context.getNarrativeState()).toEqual({ id: null, transition: "exit", revision: 4 });
    expect(context.getBasemap()).toBe("osm");
  });

  test("equal REST narrative scene cannot block a newer command scene basemap", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { applyStateFromApi } = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const inactiveScene = {
      ...ACTIVE_SCENE,
      sceneRevision: 4,
      narrativeState: { id: null, transition: "exit", revision: 4 },
      basemap: "dark",
    };
    context._applyNarrativeScene(inactiveScene);
    let resolveCommand;
    vi.spyOn(api.OTEF_API, "executeCommand").mockImplementation(() => new Promise((resolve) => {
      resolveCommand = resolve;
    }));

    const transition = context.setNarrative("segev");
    await vi.waitFor(() => expect(api.OTEF_API.executeCommand).toHaveBeenCalledTimes(1));
    const reconnectBaseline = context._captureNarrativeSceneBaseline();
    applyStateFromApi(context, {
      narrative_state: inactiveScene.narrativeState,
      basemap: inactiveScene.basemap,
      investigation_clock: inactiveScene.investigationClock,
      person_selection: inactiveScene.personSelection,
    }, { notify: true, coupledBaseline: reconnectBaseline });
    resolveCommand({
      status: "ok",
      action: "set_narrative",
      scene: {
        ...ACTIVE_SCENE,
        sceneRevision: 5,
        narrativeState: { id: "segev", transition: "enter", revision: 5 },
      },
    });
    await transition;

    expect(context.getNarrativeState()).toEqual({ id: "segev", transition: "enter", revision: 5 });
    expect(context.getBasemap()).toBe("satellite_bw");
  });

  test("rejected optimistic basemap and rollback cannot block a concurrent narrative scene", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const inactiveScene = {
      ...ACTIVE_SCENE,
      sceneRevision: 4,
      narrativeState: { id: null, transition: "exit", revision: 4 },
      basemap: "dark",
    };
    context._applyNarrativeScene(inactiveScene);
    let resolveNarrative;
    vi.spyOn(api.OTEF_API, "executeCommand").mockImplementation(() => new Promise((resolve) => {
      resolveNarrative = resolve;
    }));
    const basemapError = new Error("narrative activated before basemap update");
    vi.spyOn(api.OTEF_API, "updateBasemap").mockRejectedValue(basemapError);

    const narrativeTransition = context.setNarrative("segev");
    await vi.waitFor(() => expect(api.OTEF_API.executeCommand).toHaveBeenCalledTimes(1));
    await expect(context.setBasemap("osm")).resolves.toEqual({ ok: false, error: basemapError });
    expect(context.getBasemap()).toBe("dark");
    resolveNarrative({
      status: "ok",
      action: "set_narrative",
      scene: {
        ...ACTIVE_SCENE,
        sceneRevision: 5,
        narrativeState: { id: "segev", transition: "enter", revision: 5 },
      },
    });
    await narrativeTransition;

    expect(context.getNarrativeState()).toEqual({ id: "segev", transition: "enter", revision: 5 });
    expect(context.getBasemap()).toBe("satellite_bw");
  });

  test("a delayed rejected basemap write cannot roll back a later narrative satellite scene", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._applyNarrativeScene({
      ...ACTIVE_SCENE,
      sceneRevision: 4,
      narrativeState: { id: null, transition: "exit", revision: 4 },
      basemap: "dark",
    });
    let rejectBasemap;
    vi.spyOn(api.OTEF_API, "updateBasemap").mockImplementation(() => new Promise((_resolve, reject) => {
      rejectBasemap = reject;
    }));

    const pending = context.setBasemap("osm");
    expect(context.getBasemap()).toBe("osm");
    context._applyNarrativeScene({
      ...ACTIVE_SCENE,
      sceneRevision: 5,
      narrativeState: { id: "segev", transition: "enter", revision: 5 },
      investigationClock: { ...ACTIVE_SCENE.investigationClock, revision: 9 },
    });
    rejectBasemap(new Error("late write rejected"));

    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(context.getNarrativeState()).toMatchObject({ id: "segev", revision: 5 });
    expect(context.getBasemap()).toBe("satellite_bw");
  });

  test("a delayed successful basemap write cannot overwrite a later narrative satellite scene", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._applyNarrativeScene({
      ...ACTIVE_SCENE,
      sceneRevision: 4,
      narrativeState: { id: null, transition: "exit", revision: 4 },
      basemap: "dark",
    });
    let resolveBasemap;
    vi.spyOn(api.OTEF_API, "updateBasemap").mockImplementation(() => new Promise((resolve) => {
      resolveBasemap = resolve;
    }));

    const pending = context.setBasemap("osm");
    expect(context.getBasemap()).toBe("osm");
    context._applyNarrativeScene({
      ...ACTIVE_SCENE,
      sceneRevision: 5,
      narrativeState: { id: "segev", transition: "enter", revision: 5 },
    });
    resolveBasemap({ basemap: "osm" });

    await expect(pending).resolves.toEqual({ ok: true });
    expect(context.getNarrativeState()).toMatchObject({ id: "segev", revision: 5 });
    expect(context.getBasemap()).toBe("satellite_bw");
  });

  test("a basemap acknowledgement before a later narrative scene remains valid", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._applyNarrativeScene({
      ...ACTIVE_SCENE,
      sceneRevision: 4,
      narrativeState: { id: null, transition: "exit", revision: 4 },
      basemap: "dark",
    });
    let resolveBasemap;
    vi.spyOn(api.OTEF_API, "updateBasemap").mockImplementation(() => new Promise((resolve) => {
      resolveBasemap = resolve;
    }));

    const generation = context._independentBasemapGeneration;
    const pending = context.setBasemap("osm");
    resolveBasemap({ basemap: "osm" });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(context.getBasemap()).toBe("osm");
    expect(context._independentBasemapGeneration).toBe(generation + 1);

    context._applyNarrativeScene({
      ...ACTIVE_SCENE,
      sceneRevision: 5,
      narrativeState: { id: "segev", transition: "enter", revision: 5 },
    });
    expect(context.getBasemap()).toBe("satellite_bw");
  });

  test("an ordinary successful optimistic basemap write is confirmed", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const generation = context._independentBasemapGeneration;
    vi.spyOn(api.OTEF_API, "updateBasemap").mockResolvedValue({ basemap: "osm" });

    await expect(context.setBasemap("osm")).resolves.toEqual({ ok: true });
    expect(context.getBasemap()).toBe("osm");
    expect(context._independentBasemapGeneration).toBe(generation + 1);
  });

  test("a delayed clock response cannot regress a later narrative idle clock", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._applyNarrativeScene({
      ...ACTIVE_SCENE,
      sceneRevision: 4,
      narrativeState: { id: null, transition: "exit", revision: 4 },
      basemap: "dark",
      investigationClock: { ...ACTIVE_SCENE.investigationClock, phase: "idle", revision: 7 },
    });
    let resolveClock;
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockImplementation(() => new Promise((resolve) => {
      resolveClock = resolve;
    }));

    const playingClock = {
      ...ACTIVE_SCENE.investigationClock,
      phase: "playing",
      membership: ["nli.lines"],
      beats: [420],
      positionMs: 0,
      anchorMs: 10,
    };
    const pending = context.patchInvestigationClock(playingClock);
    await vi.waitFor(() => expect(api.OTEF_API.updateInvestigationClock).toHaveBeenCalledTimes(1));
    context._applyNarrativeScene({
      ...ACTIVE_SCENE,
      sceneRevision: 5,
      narrativeState: { id: "segev", transition: "enter", revision: 5 },
      investigationClock: { ...ACTIVE_SCENE.investigationClock, phase: "idle", revision: 9 },
    });
    resolveClock({ investigation_clock: { ...playingClock, revision: 9 } });

    await pending;
    expect(context.getNarrativeState()).toMatchObject({ id: "segev", revision: 5 });
    expect(context.getInvestigationClock()).toMatchObject({ phase: "idle", revision: 9 });
  });

  test("an ordinary clock response advances the acknowledged clock", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._applyNarrativeScene({
      ...ACTIVE_SCENE,
      sceneRevision: 4,
      narrativeState: { id: null, transition: "exit", revision: 4 },
      basemap: "dark",
      investigationClock: { ...ACTIVE_SCENE.investigationClock, phase: "idle", revision: 7 },
    });
    const playingClock = {
      ...ACTIVE_SCENE.investigationClock,
      phase: "playing",
      membership: ["nli.lines"],
      beats: [420],
      positionMs: 0,
      anchorMs: 10,
      revision: 8,
    };
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockResolvedValue({ investigation_clock: playingClock });

    await context.patchInvestigationClock(playingClock);
    expect(context.getInvestigationClock()).toMatchObject({ phase: "playing", revision: 8 });
  });

  test("an authoritative narrative-active slideshow rejection never falls back to BroadcastChannel", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const channel = vi.fn(function Channel() {
      this.postMessage = vi.fn();
      this.close = vi.fn();
    });
    vi.stubGlobal("BroadcastChannel", channel);
    context._tableName = "otef";
    vi.spyOn(api.OTEF_API, "updateState").mockRejectedValue(Object.assign(
      new Error("narrative is active"),
      { status: 409, details: { reason: "narrative_active" } },
    ));

    await expect(
      context.patchProjectionSlideshow({ type: "start", payload: { intervalMs: 1000 } }),
    ).rejects.toMatchObject({ status: 409 });

    expect(channel).not.toHaveBeenCalled();
  });

  test("confirmed same-value basemap update protects against a delayed narrative basemap", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._applyNarrativeScene(ACTIVE_SCENE);
    let resolveNarrative;
    vi.spyOn(api.OTEF_API, "executeCommand").mockImplementation(() => new Promise((resolve) => {
      resolveNarrative = resolve;
    }));
    vi.spyOn(api.OTEF_API, "updateBasemap").mockResolvedValue({
      basemap: "satellite_bw",
    });

    const narrativeTransition = context.setNarrative(null);
    await vi.waitFor(() => expect(api.OTEF_API.executeCommand).toHaveBeenCalledTimes(1));
    await expect(context.setBasemap("satellite_bw")).resolves.toEqual({ ok: true });
    resolveNarrative({
      status: "ok",
      action: "set_narrative",
      scene: {
        ...ACTIVE_SCENE,
        sceneRevision: 5,
        narrativeState: { id: null, transition: "exit", revision: 5 },
        basemap: "dark",
      },
    });
    await narrativeTransition;

    expect(context.getNarrativeState()).toEqual({ id: null, transition: "exit", revision: 5 });
    expect(context.getBasemap()).toBe("satellite_bw");
  });

  test("successful delayed narrative response preserves a newer intervening basemap update", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._applyNarrativeScene(ACTIVE_SCENE);
    let resolveCommand;
    vi.spyOn(api.OTEF_API, "executeCommand").mockImplementation(() => new Promise((resolve) => {
      resolveCommand = resolve;
    }));

    const transition = context.setNarrative(null);
    await vi.waitFor(() => expect(api.OTEF_API.executeCommand).toHaveBeenCalledTimes(1));
    context._setConfirmedBasemap("osm");
    resolveCommand({
      status: "ok",
      action: "set_narrative",
      scene: {
        ...ACTIVE_SCENE,
        sceneRevision: 5,
        narrativeState: { id: null, transition: "exit", revision: 5 },
        basemap: "dark",
      },
    });
    await transition;

    expect(context.getNarrativeState()).toEqual({ id: null, transition: "exit", revision: 5 });
    expect(context.getBasemap()).toBe("osm");
  });

  test("successful narrative response adopts its basemap when no newer update intervenes", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._applyNarrativeScene(ACTIVE_SCENE);
    vi.spyOn(api.OTEF_API, "executeCommand").mockResolvedValue({
      status: "ok",
      action: "set_narrative",
      scene: {
        ...ACTIVE_SCENE,
        sceneRevision: 5,
        narrativeState: { id: null, transition: "exit", revision: 5 },
        basemap: "dark",
      },
    });

    await context.setNarrative(null);

    expect(context.getNarrativeState()).toEqual({ id: null, transition: "exit", revision: 5 });
    expect(context.getBasemap()).toBe("dark");
  });

  test("revision-zero REST bootstrap still hydrates the complete inactive scene", async () => {
    const { applyStateFromApi } = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");

    applyStateFromApi(context, {
      narrative_state: { id: null, transition: "initial", revision: 0 },
      basemap: "dark",
      investigation_clock: { ...ACTIVE_SCENE.investigationClock, revision: 2 },
      person_selection: { personId: "p-1", datasetVersion: "v-1", revision: 1 },
    }, { notify: false });

    expect(context.getNarrativeState()).toEqual({ id: null, transition: "initial", revision: 0 });
    expect(context.getBasemap()).toBe("dark");
    expect(context.getInvestigationClock()).toMatchObject({ revision: 2 });
    expect(context.getPersonSelection()).toEqual({
      personId: "p-1",
      datasetVersion: "v-1",
      revision: 1,
    });
  });

  test("an incomplete REST narrative snapshot cannot half-apply its scene", async () => {
    const { applyStateFromApi } = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const narrativeListener = vi.fn();
    context.subscribe("narrativeState", narrativeListener);
    narrativeListener.mockClear();

    applyStateFromApi(context, {
      narrative_state: ACTIVE_SCENE.narrativeState,
      basemap: ACTIVE_SCENE.basemap,
    }, { notify: true });

    expect(context.getNarrativeState()).toEqual({ id: null, transition: "initial", revision: 0 });
    expect(context.getBasemap()).toBe("osm");
    expect(narrativeListener).not.toHaveBeenCalled();
  });

  test("stale setNarrative refreshes the complete authoritative scene and rethrows the original 409", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const conflict = Object.assign(new Error("stale narrative revision"), {
      status: 409,
      details: {
        reason: "stale",
        narrative_state: ACTIVE_SCENE.narrativeState,
      },
    });
    vi.spyOn(api.OTEF_API, "executeCommand").mockRejectedValue(conflict);
    vi.spyOn(api.OTEF_API, "getState").mockResolvedValue({
      narrative_state: ACTIVE_SCENE.narrativeState,
      basemap: ACTIVE_SCENE.basemap,
      investigation_clock: ACTIVE_SCENE.investigationClock,
      person_selection: ACTIVE_SCENE.personSelection,
    });
    const observations = [];
    context.subscribe("narrativeState", () => {
      if (context.getNarrativeState().revision === 4) {
        observations.push({
          basemap: context.getBasemap(),
          clock: context.getInvestigationClock(),
          person: context.getPersonSelection(),
        });
      }
    });

    await expect(context.setNarrative("segev")).rejects.toBe(conflict);

    expect(api.OTEF_API.getState).toHaveBeenCalledWith("otef", { forceFresh: true });
    expect(context.getNarrativeState()).toEqual(ACTIVE_SCENE.narrativeState);
    expect(observations).toEqual([{
      basemap: "satellite_bw",
      clock: expect.objectContaining({ revision: 8 }),
      person: ACTIVE_SCENE.personSelection,
    }]);
  });

  test("stale setNarrative reconciliation cannot overwrite a newer intervening WebSocket scene", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const conflict = Object.assign(new Error("stale narrative revision"), {
      status: 409,
      details: { reason: "stale", narrative_state: ACTIVE_SCENE.narrativeState },
    });
    vi.spyOn(api.OTEF_API, "executeCommand").mockRejectedValue(conflict);
    let resolveSnapshot;
    vi.spyOn(api.OTEF_API, "getState").mockImplementation(() => new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));

    const transition = context.setNarrative("segev");
    await vi.waitFor(() => expect(api.OTEF_API.getState).toHaveBeenCalledTimes(1));
    const newerScene = {
      ...ACTIVE_SCENE,
      sceneRevision: 5,
      narrativeState: { id: null, transition: "exit", revision: 5 },
      basemap: "dark",
      investigationClock: { ...ACTIVE_SCENE.investigationClock, revision: 9 },
      personSelection: { personId: null, datasetVersion: null, revision: 4 },
    };
    context._applyNarrativeScene(newerScene);
    resolveSnapshot({
      narrative_state: ACTIVE_SCENE.narrativeState,
      basemap: ACTIVE_SCENE.basemap,
      investigation_clock: ACTIVE_SCENE.investigationClock,
      person_selection: ACTIVE_SCENE.personSelection,
    });

    await expect(transition).rejects.toBe(conflict);
    expect(context.getNarrativeState()).toEqual(newerScene.narrativeState);
    expect(context.getBasemap()).toBe("dark");
    expect(context.getInvestigationClock()).toMatchObject({ revision: 9 });
    expect(context.getPersonSelection()).toEqual(newerScene.personSelection);
  });

  test("relays sanitized ephemeral presentation commands and results with cleanup", async () => {
    installWebSocketMock();
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    websocket.setupWebSocket(context);
    const commands = vi.fn();
    const results = vi.fn();
    const stopCommands = context.subscribe("narrativePresentation", commands);
    const stopResults = context.subscribe("narrativePresentationResult", results);

    context._wsClient.listeners.get("otef_narrative_presentation_command")({
      table: "otef",
      presentationAction: "open",
      narrativeId: "segev",
      requestId: "request-1",
      sourceId: "remote-a",
      acknowledged: true,
      presentationUrl: "https://attacker.invalid/embed",
    });
    context._wsClient.listeners.get("otef_narrative_presentation_result")({
      table: "otef",
      outcome: "opened",
      narrativeId: "segev",
      requestId: "request-1",
      sourceId: "gis-a",
      acknowledged: true,
      center: [0, 0],
    });

    expect(commands).toHaveBeenCalledWith({
      presentationAction: "open",
      narrativeId: "segev",
      requestId: "request-1",
      sourceId: "remote-a",
      acknowledged: true,
    });
    expect(results).toHaveBeenCalledWith({
      outcome: "opened",
      narrativeId: "segev",
      requestId: "request-1",
      sourceId: "gis-a",
      acknowledged: true,
    });

    stopCommands();
    stopResults();
    context._wsClient.listeners.get("otef_narrative_presentation_command")({
      presentationAction: "close",
      narrativeId: "segev",
      requestId: "request-2",
      sourceId: "remote-a",
    });
    expect(commands).toHaveBeenCalledTimes(1);
  });

  test("context sends correlated presentation command and result metadata", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    vi.spyOn(api.OTEF_API, "narrativePresentationCommand").mockResolvedValue({ status: "ok" });
    vi.spyOn(api.OTEF_API, "narrativePresentationResult").mockResolvedValue({ status: "ok" });

    await context.narrativePresentationCommand("open", "segev", "request-1");
    await context.narrativePresentationResult("opened", "segev", "request-1");

    expect(api.OTEF_API.narrativePresentationCommand).toHaveBeenCalledWith("otef", {
      presentationAction: "open",
      narrativeId: "segev",
      requestId: "request-1",
      sourceId: context._clientId,
      timestamp: expect.any(Number),
    });
    expect(api.OTEF_API.narrativePresentationResult).toHaveBeenCalledWith("otef", {
      outcome: "opened",
      narrativeId: "segev",
      requestId: "request-1",
      sourceId: context._clientId,
      timestamp: expect.any(Number),
    });
  });
});
