import { afterEach, describe, expect, test, vi } from "vitest";
import { createNliArchivePagerClient } from "../../frontend/src/map/nli-archive-pager-client.js";

const PAGE_URL = "http://127.0.0.1:7733/page";

afterEach(() => {
  vi.useRealTimers();
});

describe("NLI archive pager client", () => {
  test("posts direction and requestId as JSON to the loopback pager", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const client = createNliArchivePagerClient({ fetchImpl });

    await client.page("down", "req-9");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(PAGE_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ direction: "down", requestId: "req-9" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("resolves when the pager fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const client = createNliArchivePagerClient({ fetchImpl });

    await expect(client.page("down", "req-fail")).resolves.toBeUndefined();
  });

  test("aborts the in-flight fetch at the timeout and still resolves", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }));
    const client = createNliArchivePagerClient({ fetchImpl, timeoutMs: 800 });
    const pending = client.page("up", "req-abort");

    await vi.advanceTimersByTimeAsync(799);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });

  test("drops an overlapping page until the in-flight fetch settles", async () => {
    let release;
    const fetchImpl = vi.fn(() => new Promise((resolve) => {
      release = () => resolve({ ok: true });
    }));
    const client = createNliArchivePagerClient({ fetchImpl });

    const first = client.page("down", "req-a");
    const second = client.page("up", "req-b");

    await expect(second).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).requestId).toBe("req-a");

    release();
    await first;

    const third = client.page("up", "req-c");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ direction: "up", requestId: "req-c" });
    release();
    await third;
  });
});
