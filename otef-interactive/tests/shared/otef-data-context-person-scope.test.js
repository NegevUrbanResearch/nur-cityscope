import { afterEach, beforeEach, expect, test, vi } from "vitest";

let api, selectPerson, setEscapeOverlay, archiveWindowResult, narrativePresentationResult;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
function makeContext() {
  const ctx = {
    _tableName: "otef", _clientId: "remote", _personSelection: { personId: null, datasetVersion: null, revision: 1 },
    epoch: 1,
    captureExperienceScope() { return { experience: "nli", experience_revision: this.epoch }; },
    isExperienceScopeCurrent(scope) { return scope.experience === "nli" && scope.experience_revision === this.epoch; },
    getNarrativeState: () => ({ id: "nova" }), getEscapeOverlay: () => ({}),
    _applyEscapeOverlay: vi.fn(),
    _setPersonSelection: vi.fn(function (selection) { this._personSelection = selection; }),
  };
  return ctx;
}
beforeEach(async () => {
  vi.resetModules();
  ({ OTEF_API: api } = await import("../../frontend/src/shared/api-client.js"));
  ({ selectPerson, archiveWindowResult } = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-person-actions.js"));
  ({ setEscapeOverlay, narrativePresentationResult } = await import("../../frontend/src/shared/otef-data-context/OTEFDataContext-actions.js"));
});
afterEach(() => vi.restoreAllMocks());

test("delayed archive and presentation results cannot adopt a later activation", async () => {
  const ctx = makeContext();
  ctx.epoch = 3;
  const oldScope = { experience: "nli", experience_revision: 1 };
  const archive = vi.spyOn(api, "archiveWindowResult").mockResolvedValue({ ok: true });
  const presentation = vi.spyOn(api, "narrativePresentationResult").mockResolvedValue({ ok: true });
  expect(await archiveWindowResult(ctx, "closed", "11", "dataset", "request", "gis", oldScope)).toMatchObject({ stale: true });
  const result = { segmentId: "nova", presentationSessionId: "s", presentationGeneration: 1,
    sequence: 1, requestId: "request", outcome: "closed", ...oldScope };
  expect(await narrativePresentationResult(ctx, result)).toMatchObject({ stale: true });
  expect(archive).not.toHaveBeenCalled();
  expect(presentation).not.toHaveBeenCalled();
  await archiveWindowResult(ctx, "closed", "11", "dataset", "request", "gis", ctx.captureExperienceScope());
  await narrativePresentationResult(ctx, { ...result, ...ctx.captureExperienceScope() });
  expect(archive.mock.calls[0][1]).toMatchObject(ctx.captureExperienceScope());
  expect(presentation.mock.calls[0][1]).toMatchObject(ctx.captureExperienceScope());
});

test("a late person revision conflict cannot retry an old selection in a later NLI activation", async () => {
  const ctx = makeContext(), response = deferred();
  const write = vi.spyOn(api, "selectPerson").mockReturnValue(response.promise);
  const result = selectPerson(ctx, "11", "dataset").catch(error => error);
  ctx.epoch = 3;
  response.reject(Object.assign(new Error("stale person"), { status: 409,
    details: { reason: "stale", person_selection: { personId: "12", datasetVersion: "dataset", revision: 2 } } }));
  expect((await result).status).toBe(409);
  expect(write).toHaveBeenCalledTimes(1);
  expect(ctx._setPersonSelection).not.toHaveBeenCalled();
});

test("same-activation person conflict retry retains the original scope on both attempts", async () => {
  const ctx = makeContext();
  const write = vi.spyOn(api, "selectPerson")
    .mockRejectedValueOnce(Object.assign(new Error("stale"), { status: 409,
      details: { reason: "stale", person_selection: { personId: "12", datasetVersion: "dataset", revision: 2 } } }))
    .mockResolvedValueOnce({ person_selection: { personId: "11", datasetVersion: "dataset", revision: 3 } });
  await selectPerson(ctx, "11", "dataset");
  expect(write).toHaveBeenCalledTimes(2);
  for (const call of write.mock.calls) expect(call[3]).toMatchObject({ experience: "nli", experience_revision: 1 });
  expect(ctx._personSelection.personId).toBe("11");
});

test("an old successful person response cannot replace the destination selection", async () => {
  const ctx = makeContext(), response = deferred();
  vi.spyOn(api, "selectPerson").mockReturnValue(response.promise);
  const result = selectPerson(ctx, "11", "dataset").catch(error => error);
  ctx.epoch = 3;
  response.resolve({ person_selection: { personId: "11", datasetVersion: "dataset", revision: 20 } });
  expect((await result).status).toBe(409);
  expect(ctx._setPersonSelection).not.toHaveBeenCalled();
});

test("an old escape-overlay acknowledgement cannot overwrite a later NLI activation", async () => {
  const ctx = makeContext(), response = deferred();
  const write = vi.spyOn(api, "setEscapeOverlay").mockReturnValue(response.promise);
  const result = setEscapeOverlay(ctx, { individual: true }).catch(error => error);
  ctx.epoch = 3;
  response.resolve({ escapeOverlay: { individual: true, overlap: false, mor: false, settled: false } });
  expect((await result).status).toBe(409);
  expect(ctx._applyEscapeOverlay).not.toHaveBeenCalled();
  expect(write.mock.calls[0][2]).toMatchObject({ experience: "nli", experience_revision: 1 });
});
