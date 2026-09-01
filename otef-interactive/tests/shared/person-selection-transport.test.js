import { beforeEach, describe, expect, test, vi } from "vitest";

describe("person selection transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
  });

  test("normalizes to the exact three-field snapshot and keeps a valid revision", async () => {
    const { normalizePersonSelection } = await import(
      "../../frontend/src/shared/person-selection.js"
    );

    expect(normalizePersonSelection({
      personId: "p-1",
      datasetVersion: "sha256:v1",
      revision: 3,
      name: "not transported",
    })).toEqual({ personId: "p-1", datasetVersion: "sha256:v1", revision: 3 });
    expect(normalizePersonSelection({ personId: "p-1", revision: 4 })).toEqual({
      personId: null,
      datasetVersion: null,
      revision: 4,
    });
    expect(normalizePersonSelection({ personId: 7, datasetVersion: "v1", revision: 2 })).toEqual({
      personId: null,
      datasetVersion: null,
      revision: 2,
    });
    expect(normalizePersonSelection({ personId: "", datasetVersion: "v1", revision: -1 })).toEqual({
      personId: null,
      datasetVersion: null,
      revision: 0,
    });
  });

  test("API helpers reuse command endpoint with selection payloads", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");

    await OTEF_API.selectPerson("p-1", "v1", 6);
    await OTEF_API.clearPerson(7);

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      action: "select_person",
      personId: "p-1",
      datasetVersion: "v1",
      expectedRevision: 6,
    });
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
      action: "clear_person",
      expectedRevision: 7,
    });
    expect(global.fetch.mock.calls[0][0]).toContain("/otef/command/");
  });

  test("API helper sends a correlated archive result without a URL", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");

    await OTEF_API.archiveWindowResult("otef", {
      outcome: "navigation_attempted",
      personId: "p-1",
      datasetVersion: "v1",
      requestId: "request-1",
      sourceId: "gis-a",
    });

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      action: "archive_window_result",
      outcome: "navigation_attempted",
      personId: "p-1",
      datasetVersion: "v1",
      requestId: "request-1",
      sourceId: "gis-a",
    });
  });

  test("command errors retain HTTP status and response details", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "stale person selection revision",
        person_selection: { personId: "p-2", datasetVersion: "v2", revision: 9 },
      }),
    });
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");

    await expect(OTEF_API.clearPerson("otef", 8)).rejects.toMatchObject({
      status: 409,
      details: { person_selection: { revision: 9 } },
    });
  });

  test("context hydrates, exposes, and subscribes to person selection", async () => {
    const { applyStateFromApi } = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const listener = vi.fn();

    expect(context.getPersonSelection()).toEqual({ personId: null, datasetVersion: null, revision: 0 });
    const dispose = context.subscribe("personSelection", listener);
    expect(listener).toHaveBeenCalledWith({ personId: null, datasetVersion: null, revision: 0 });
    applyStateFromApi(context, {
      person_selection: { personId: "p-1", datasetVersion: "v1", revision: 2 },
    }, { notify: true });
    expect(context.getPersonSelection()).toEqual({ personId: "p-1", datasetVersion: "v1", revision: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
    dispose();
    applyStateFromApi(context, {
      person_selection: { personId: "p-2", datasetVersion: "v2", revision: 3 },
    }, { notify: true });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("select and clear apply acknowledged snapshots without optimistic mutation", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    vi.spyOn(api.OTEF_API, "selectPerson").mockResolvedValue({
      status: "ok",
      person_selection: { personId: "p-1", datasetVersion: "v1", revision: 1 },
    });
    vi.spyOn(api.OTEF_API, "clearPerson").mockResolvedValue({
      status: "ok",
      person_selection: { personId: null, datasetVersion: null, revision: 2 },
    });

    await context.selectPerson("p-1", "v1");
    expect(context.getPersonSelection()).toEqual({ personId: "p-1", datasetVersion: "v1", revision: 1 });
    await context.clearPerson();
    expect(context.getPersonSelection()).toEqual({ personId: null, datasetVersion: null, revision: 2 });
    expect(api.OTEF_API.selectPerson).toHaveBeenCalledWith("p-1", "v1", 0, expect.objectContaining({ tableName: "otef" }));
    expect(api.OTEF_API.clearPerson).toHaveBeenCalledWith(1, expect.objectContaining({ tableName: "otef" }));
  });

  test("failed selection leaves the local snapshot unchanged", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._setPersonSelection({ personId: "p-0", datasetVersion: "v0", revision: 4 });
    vi.spyOn(api.OTEF_API, "selectPerson").mockRejectedValue(Object.assign(new Error("conflict"), {
      status: 409,
      details: { person_selection: { revision: 5 } },
    }));

    await expect(context.selectPerson("p-1", "v1")).rejects.toMatchObject({ status: 409 });
    expect(context.getPersonSelection()).toEqual({ personId: "p-0", datasetVersion: "v0", revision: 4 });
  });

  test("uses stable stale reason when conflict wording changes and retries select once", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._setPersonSelection({ personId: "p-0", datasetVersion: "v0", revision: 4 });
    vi.spyOn(api.OTEF_API, "selectPerson")
      .mockRejectedValueOnce(Object.assign(new Error("selection conflict wording changed"), {
        status: 409,
        details: {
          error: "selection conflict wording changed",
          reason: "stale",
          person_selection: { personId: "p-9", datasetVersion: "v9", revision: 7 },
        },
      }))
      .mockResolvedValueOnce({
        person_selection: { personId: "p-1", datasetVersion: "v1", revision: 8 },
      });

    await context.selectPerson("p-1", "v1");

    expect(api.OTEF_API.selectPerson).toHaveBeenNthCalledWith(
      1,
      "p-1",
      "v1",
      4,
      expect.objectContaining({ tableName: "otef" }),
    );
    expect(api.OTEF_API.selectPerson).toHaveBeenNthCalledWith(
      2,
      "p-1",
      "v1",
      7,
      expect.objectContaining({ tableName: "otef" }),
    );
    expect(context.getPersonSelection()).toEqual({ personId: "p-1", datasetVersion: "v1", revision: 8 });
  });

  test("retries with a WebSocket-advanced revision when the first HTTP response is stale", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._setPersonSelection({ personId: "p-0", datasetVersion: "v0", revision: 4 });

    let rejectFirst;
    let resolveRetry;
    vi.spyOn(api.OTEF_API, "selectPerson")
      .mockImplementationOnce(() => new Promise((resolve, reject) => {
        rejectFirst = reject;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRetry = resolve;
      }));

    const selectionPromise = context.selectPerson("p-1", "v1");
    await vi.waitFor(() => expect(api.OTEF_API.selectPerson).toHaveBeenCalledTimes(1));
    expect(api.OTEF_API.selectPerson).toHaveBeenNthCalledWith(
      1,
      "p-1",
      "v1",
      4,
      expect.objectContaining({ tableName: "otef" }),
    );

    websocket.applyPersonSelectionIfNewer(context, {
      personId: "p-2", datasetVersion: "v2", revision: 5,
    });
    rejectFirst(Object.assign(new Error("stale"), {
      status: 409,
      details: {
        error: "stale person selection revision",
        person_selection: { personId: "p-2", datasetVersion: "v2", revision: 5 },
      },
    }));

    await vi.waitFor(() => expect(api.OTEF_API.selectPerson).toHaveBeenCalledTimes(2));
    expect(api.OTEF_API.selectPerson).toHaveBeenNthCalledWith(
      2,
      "p-1",
      "v1",
      5,
      expect.objectContaining({ tableName: "otef" }),
    );
    resolveRetry({
      person_selection: { personId: "p-1", datasetVersion: "v1", revision: 6 },
    });
    await selectionPromise;

    expect(context.getPersonSelection()).toEqual({ personId: "p-1", datasetVersion: "v1", revision: 6 });
  });

  test("hydrates a stale snapshot and retries clear once, but rejects a second conflict", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._setPersonSelection({ personId: "p-1", datasetVersion: "v1", revision: 4 });
    const stale = () => Object.assign(new Error("stale"), {
      status: 409,
      details: {
        error: "stale person selection revision",
        person_selection: { personId: "p-2", datasetVersion: "v2", revision: 5 },
      },
    });
    vi.spyOn(api.OTEF_API, "clearPerson")
      .mockRejectedValueOnce(stale())
      .mockRejectedValueOnce(stale());

    await expect(context.clearPerson()).rejects.toMatchObject({ status: 409 });
    expect(api.OTEF_API.clearPerson).toHaveBeenCalledTimes(2);
    expect(api.OTEF_API.clearPerson).toHaveBeenNthCalledWith(
      1,
      4,
      expect.objectContaining({ tableName: "otef" }),
    );
    expect(api.OTEF_API.clearPerson).toHaveBeenNthCalledWith(
      2,
      5,
      expect.objectContaining({ tableName: "otef" }),
    );
    expect(context.getPersonSelection()).toEqual({ personId: "p-2", datasetVersion: "v2", revision: 5 });
  });

  test("does not retry a clock_active conflict as stale", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._setPersonSelection({ personId: "p-0", datasetVersion: "v0", revision: 4 });
    vi.spyOn(api.OTEF_API, "selectPerson").mockRejectedValue(Object.assign(new Error("clock active"), {
      status: 409,
      details: {
        error: "clock_active",
        person_selection: { personId: "p-0", datasetVersion: "v0", revision: 4 },
      },
    }));

    await expect(context.selectPerson("p-1", "v1")).rejects.toMatchObject({ status: 409 });
    expect(api.OTEF_API.selectPerson).toHaveBeenCalledTimes(1);
    expect(context.getPersonSelection()).toEqual({ personId: "p-0", datasetVersion: "v0", revision: 4 });
  });

  test("does not retry a stale conflict with an invalid authoritative snapshot", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    context._setPersonSelection({ personId: "p-0", datasetVersion: "v0", revision: 4 });
    vi.spyOn(api.OTEF_API, "selectPerson").mockRejectedValue(Object.assign(new Error("stale"), {
      status: 409,
      details: {
        error: "stale person selection revision",
        person_selection: { personId: "p-9", datasetVersion: null, revision: 5 },
      },
    }));

    await expect(context.selectPerson("p-1", "v1")).rejects.toMatchObject({ status: 409 });
    expect(api.OTEF_API.selectPerson).toHaveBeenCalledTimes(1);
    expect(context.getPersonSelection()).toEqual({ personId: "p-0", datasetVersion: "v0", revision: 4 });
  });

  test("delayed select and clear acknowledgments cannot regress a newer WebSocket revision", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    let resolveSelect;
    let resolveClear;
    vi.spyOn(api.OTEF_API, "selectPerson").mockImplementation(() => new Promise((resolve) => {
      resolveSelect = resolve;
    }));
    vi.spyOn(api.OTEF_API, "clearPerson").mockImplementation(() => new Promise((resolve) => {
      resolveClear = resolve;
    }));

    const selectPromise = context.selectPerson("p-1", "v1");
    websocket.applyPersonSelectionIfNewer(context, { personId: "p-2", datasetVersion: "v2", revision: 2 });
    resolveSelect({ person_selection: { personId: "p-1", datasetVersion: "v1", revision: 1 } });
    await selectPromise;
    expect(context.getPersonSelection()).toEqual({ personId: "p-2", datasetVersion: "v2", revision: 2 });

    const clearPromise = context.clearPerson();
    websocket.applyPersonSelectionIfNewer(context, { personId: "p-3", datasetVersion: "v3", revision: 3 });
    resolveClear({ person_selection: { personId: null, datasetVersion: null, revision: 1 } });
    await clearPromise;
    expect(context.getPersonSelection()).toEqual({ personId: "p-3", datasetVersion: "v3", revision: 3 });
  });

  test("WebSocket selection applies only newer revisions", async () => {
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const listener = vi.fn();
    context._setPersonSelection({ personId: "p-1", datasetVersion: "v1", revision: 4 });
    context.subscribe("personSelection", listener);
    listener.mockClear();

    websocket.applyPersonSelectionIfNewer(context, {
      personId: "p-2", datasetVersion: "v2", revision: 4,
    });
    websocket.applyPersonSelectionIfNewer(context, {
      personId: "p-2", datasetVersion: "v2", revision: 3,
    });
    expect(listener).not.toHaveBeenCalled();

    websocket.applyPersonSelectionIfNewer(context, {
      personId: "p-2", datasetVersion: "v2", revision: 5,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(context.getPersonSelection()).toEqual({ personId: "p-2", datasetVersion: "v2", revision: 5 });
  });

  test("WebSocket registers the person-selection event handler", async () => {
    vi.doMock("../../frontend/src/shared/websocket-client.js", () => ({
      OTEFWebSocketClient: class {
        constructor() { this.listeners = new Map(); }
        on(type, callback) { this.listeners.set(type, callback); }
        connect() {}
      },
    }));
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    websocket.setupWebSocket(context);

    const handler = context._wsClient.listeners.get("otef_person_selection_changed");
    expect(handler).toEqual(expect.any(Function));
    handler({ personSelection: { personId: "p-9", datasetVersion: "v9", revision: 1 } });
    expect(context.getPersonSelection()).toEqual({ personId: "p-9", datasetVersion: "v9", revision: 1 });
  });

  test("WebSocket delivers archive results on a dedicated subscription topic", async () => {
    vi.doMock("../../frontend/src/shared/websocket-client.js", () => ({
      OTEFWebSocketClient: class {
        constructor() { this.listeners = new Map(); }
        on(type, callback) { this.listeners.set(type, callback); }
        connect() {}
      },
    }));
    const websocket = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js");
    const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
    context._tableName = "otef";
    const listener = vi.fn();
    context.subscribe("archiveWindowResult", listener);
    websocket.setupWebSocket(context);

    context._wsClient.listeners.get("otef_archive_window_result")({
      type: "otef_archive_window_result",
      table: "otef",
      requestId: "request-1",
      personId: "p-1",
      datasetVersion: "v1",
      sourceId: "gis-a",
      outcome: "navigation_attempted",
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-1",
      outcome: "navigation_attempted",
    }));
  });
});
