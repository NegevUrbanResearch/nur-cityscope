import { describe, expect, it, vi } from "vitest";
import { createStaffRemoteUpdateApi, readFrontendBuildId } from "../../frontend/src/shared/staff-remote-update-api.js";

const deviceId = "11111111-1111-4111-8111-111111111111";
const state = { table: "otef", revision: 2, deviceId, notice: { revision: 2, targetBuildId: "frontend-aaaaaaaaaaaaaaaa", createdAt: "2026-10-10T00:00:00Z" } };

describe("staff update HTTP boundaries", () => {
  it("reads the marker as data and rejects code, malformed IDs and oversized responses", async () => {
    for (const body of ['export const FRONTEND_BUILD_ID = "frontend-0123456789abcdef";\n',
      'globalThis.pwned = true;', 'export const FRONTEND_BUILD_ID = "wrong";', 'x'.repeat(1025)]) {
      const read = () => readFrontendBuildId({ fetchImpl: async () => new Response(body) });
      if (body.includes("012345")) expect(await read()).toBe("frontend-0123456789abcdef");
      else await expect(read()).rejects.toThrow();
    }
    expect(globalThis.pwned).toBeUndefined();
  });

  it("returns validated state and retains conflict state without retrying writes", async () => {
    const calls = [];
    const api = createStaffRemoteUpdateApi({ fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return options.method === "POST" ? Response.json({ error: "conflict", state }, { status: 409 }) : Response.json(state);
    } });
    expect(await api.read({ deviceId })).toEqual(state);
    await expect(api.send({ deviceId, expectedRevision: 1, targetBuildId: state.notice.targetBuildId })).rejects.toMatchObject({ code: "conflict", state });
    expect(calls).toHaveLength(2);
    expect(calls[0].options.cache).toBe("no-store");
    expect(JSON.parse(calls[1].options.body).expectedRevision).toBe(1);
    const malformed = createStaffRemoteUpdateApi({ fetchImpl: async () => Response.json({ ...state, revision: -1 }) });
    await expect(malformed.read()).rejects.toThrow();
  });

  it("aborts a stalled read after three seconds even when fetch ignores abort", async () => {
    vi.useFakeTimers();
    let signal;
    const api = createStaffRemoteUpdateApi({ fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
    const pending = api.read();
    const rejected = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(signal.aborted).toBe(true);
    vi.useRealTimers();
  });
});
