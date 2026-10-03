import { expect, test, vi } from "vitest";
import { cancelProjectionPreviewNames, commitProjectionPreviewNamesCandidate, rollbackProjectionPreviewApply, settleProjectionPreviewTaskOnAbort } from "../../frontend/src/projection/projection-preview-task.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("a newer geometry acknowledges while cold names wait on fonts and canceled names never commit", async () => {
  const fontReady = deferred();
  const fontEntered = deferred();
  const firstNames = new AbortController();
  let namesTask;
  let geometryAcks = 0;
  let namesCommitted = false;
  const applyGeometry = async () => {
    await cancelProjectionPreviewNames({ abort: () => firstNames.abort(), pending: namesTask });
    geometryAcks += 1;
  };
  geometryAcks += 1; // First calibrated geometry drew and was acknowledged.
  namesTask = settleProjectionPreviewTaskOnAbort((async () => {
    fontEntered.resolve();
    await fontReady.promise;
    if (firstNames.signal.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    namesCommitted = true;
  })(), firstNames.signal);
  namesTask.catch(() => {});
  await fontEntered.promise;

  const secondGeometry = applyGeometry();
  await secondGeometry;
  expect(geometryAcks).toBe(2);
  expect(namesCommitted).toBe(false);

  fontReady.resolve();
  await Promise.allSettled([secondGeometry, namesTask]);
  expect(namesCommitted).toBe(false);
});

test("disposing a preview settles its waiting names task promptly", async () => {
  const fonts = deferred();
  const controller = new AbortController();
  const run = vi.fn(async () => { await fonts.promise; });
  const namesTask = settleProjectionPreviewTaskOnAbort(run(), controller.signal);
  namesTask.catch(() => {});
  await cancelProjectionPreviewNames({ abort: () => controller.abort(), pending: namesTask });
  let settled = false;
  namesTask.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(true);
  fonts.resolve();
});

test("newer geometry cancels an explicit Run names before its late preparation can commit", async () => {
  const preparation = deferred();
  const controller = new AbortController();
  let namesCommitted = false;
  const runNames = settleProjectionPreviewTaskOnAbort((async () => {
    await preparation.promise;
    if (controller.signal.aborted) throw Object.assign(new Error("superseded"), { name: "AbortError" });
    namesCommitted = true;
  })(), controller.signal);
  runNames.catch(() => {});
  await cancelProjectionPreviewNames({ abort: () => controller.abort(), pending: runNames });
  await expect(runNames).rejects.toMatchObject({ name: "AbortError" });
  preparation.resolve();
  await Promise.resolve();
  expect(namesCommitted).toBe(false);
});

test("a superseded stalled rollback cannot resume its redraw or start a stale rollback", async () => {
  const controller = new AbortController();
  let current = true;
  const rollback = vi.fn();
  const draw = vi.fn();
  let resolveRender;
  const render = new Promise((resolve) => { resolveRender = resolve; });
  const pending = rollbackProjectionPreviewApply({
    isCurrent: () => current,
    signal: controller.signal,
    rollback,
    redraw: (signal) => new Promise((resolve, reject) => {
      const onAbort = () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
      signal.addEventListener("abort", onAbort, { once: true });
      render.then(() => {
        signal.removeEventListener("abort", onAbort);
        if (!signal.aborted) draw();
        resolve();
      });
    }),
  });
  expect(rollback).toHaveBeenCalledOnce();
  current = false;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  resolveRender();
  await Promise.resolve();
  expect(draw).not.toHaveBeenCalled();

  await expect(rollbackProjectionPreviewApply({ isCurrent: () => false, rollback, redraw: draw })).resolves.toBe(false);
  expect(rollback).toHaveBeenCalledOnce();
});

test.each([
  ["operation timeout", ({ operationSignal }) => operationSignal.abort()],
  ["new geometry", ({ requestSignal }) => requestSignal.abort()],
  ["preview disposal", ({ requestSignal, retireRequest }) => { retireRequest(); requestSignal.abort(); }],
])(
  "retired names preparation after %s does not rollback or draw",
  async (_reason, retire) => {
    const preparation = deferred();
    const operation = new AbortController();
    const request = new AbortController();
    let requestCurrent = true;
    const commit = vi.fn(); const draw = vi.fn(() => true);
    const rollback = vi.fn(); const finalize = vi.fn();
    const candidate = commitProjectionPreviewNamesCandidate({
      prepare: () => preparation.promise,
      isCurrent: () => requestCurrent && !operation.signal.aborted && !request.signal.aborted,
      commit, draw, rollback, finalize,
    });
    retire({ operationSignal: operation, requestSignal: request, retireRequest: () => { requestCurrent = false; } });
    preparation.resolve();
    await expect(candidate).rejects.toMatchObject({ name: "AbortError" });
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  },
);

test("current names draw failure still rolls back and redraws the accepted state", async () => {
  const current = true;
  const order = [];
  await expect(commitProjectionPreviewNamesCandidate({
    prepare: vi.fn(),
    isCurrent: () => current,
    commit: () => order.push("commit"),
    draw: () => { order.push("draw"); return order.filter((item) => item === "draw").length > 1; },
    finalize: () => order.push("finalize"),
    rollback: () => order.push("rollback"),
  })).rejects.toThrow("Projection names draw failed");
  expect(order).toEqual(["commit", "draw", "rollback", "draw"]);
});
