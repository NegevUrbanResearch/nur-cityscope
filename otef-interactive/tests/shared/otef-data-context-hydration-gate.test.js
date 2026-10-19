import { afterEach, beforeEach, expect, test, vi } from "vitest";

let context, api, sockets;
beforeEach(async () => {
  vi.resetModules();
  sockets = [];
  vi.stubGlobal("window", { location: { protocol: "http:", host: "test" } });
  vi.stubGlobal("WebSocket", class {
    static CONNECTING = 0; static OPEN = 1;
    constructor() { this.readyState = 0; sockets.push(this); }
    close() { this.readyState = 3; }
  });
  ({ default: context } = await import("../../frontend/src/shared/OTEFDataContext.js"));
  ({ OTEF_API: api } = await import("../../frontend/src/shared/api-client.js"));
  context._tableName = "otef";
});
afterEach(() => { context?._wsClient?.disconnect(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("a socket connection does not enable stale controls after canonical hydration fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(api, "getState").mockRejectedValue(new Error("HTTP unavailable"));
  context._setupWebSocket();
  sockets[0].readyState = 1;
  sockets[0].onopen();
  for (let count = 0; count < 8; count++) await Promise.resolve();
  expect(context.isConnected()).toBe(false);
  expect(context._connectionStatus).toBe("error");
});

test("presentation command delivery retains its accepted activation for delayed viewer replies", () => {
  context._setupWebSocket();
  context.adoptAuthoritativeSnapshot({ experience_state: { active_experience: "nli", revision: 1 } });
  const command = vi.fn();
  context.subscribe("narrativePresentation", command);
  const scope = { experience: "nli", experience_revision: 1 };
  context._wsClient.listeners.get("otef_narrative_presentation_command")[0]({
    table: "otef", presentationAction: "open", segmentId: "nova", presentationSessionId: "s",
    presentationGeneration: 1, sequence: 1, requestId: "r", sourceId: "remote", ...scope,
  });
  expect(command).toHaveBeenCalledOnce();
  expect(command.mock.calls[0][0]).toMatchObject(scope);
});
