import { expect, test, vi } from "vitest";
import { cancelProjectionPreviewNames, settleProjectionPreviewTaskOnAbort } from "../../frontend/src/projection/projection-preview-task.js";

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
