// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createSettlementNameClient } from "../../frontend/src/projection-config/settlement-name-client.js";
import { openSettlementNameEditor } from "../../frontend/src/projection-config/settlement-name-editor-dialog.js";
import { settlementOutline } from "../../frontend/src/projection-config/settlement-name-geometry.js";

const catalog = { entries: [
  { citycode: "0067", text: "נירים", lng: 34.4, lat: 31.3 },
  { citycode: "0424", text: "מחוץ", lng: 34.2, lat: 31.2 },
] };

function settingsFixture() {
  return {
    baseline: {
      captureId: "fixture-settlement-name", captureDigest: "a".repeat(64), sourceDigest: "b".repeat(64), catalogDigest: "c".repeat(64),
      predecessor: { revision: 1, configDigest: "d".repeat(64) }, successor: { revision: 2, configDigest: "e".repeat(64) },
      outputs: { left: { "0067": { x: 500, y: 340 }, "0424": { x: 800, y: 400 } }, right: { "0067": { x: 1200, y: 360 }, "0424": { x: 900, y: 420 } } },
    },
    style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
    outputs: { left: {}, right: {} },
  };
}

const identityMesh = { width: 1920, height: 1080, vertices: [
  { u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 1, y: 0 }, { u: 1, v: 1, x: 1, y: 1 }, { u: 0, v: 1, x: 0, y: 1 },
], triangles: [0, 1, 2, 0, 2, 3] };
const reversedMesh = { width: 1920, height: 1080, vertices: [
  { u: 1, v: 0, x: 0, y: 0 }, { u: 0, v: 0, x: 1, y: 0 }, { u: 0, v: 1, x: 1, y: 1 }, { u: 1, v: 1, x: 0, y: 1 },
], triangles: [0, 1, 2, 0, 2, 3] };
const splitMesh = { width: 1920, height: 1080, vertices: [
  { u: 0, v: 0, x: 0, y: 0 }, { u: 0.5, v: 0, x: 0.5, y: 0 }, { u: 1, v: 0, x: 1, y: 0 },
  { u: 0, v: 1, x: 0, y: 1 }, { u: 0.5, v: 1, x: 0.5, y: 1 }, { u: 1, v: 1, x: 1, y: 1 },
], triangles: [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4] };

const label = (patch = {}) => ({ citycode: "0067", text: "נירים", x: 500, y: 340, rotateDeg: 35, inkBox: { left: 470, top: 320, right: 530, bottom: 360 }, ...patch });
let editor;
afterEach(() => { editor?.close(); editor = null; document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function rig(options = {}) {
  window.history.replaceState({}, "", "/frontend/projection-config.html");
  const bounds = options.bounds || { left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ ...bounds, toJSON() { return {}; } });
  let revision = 1;
  let current = settingsFixture();
  const writeOperation = vi.fn(async (body) => {
    if (body.operation === "position") current.outputs[body.output][body.citycode] = { ...body.position };
    if (body.operation === "style") current.style = { ...body.style };
    revision += 1;
    return { status: "ok", settlementNameSettings: structuredClone(current), settlementNameRevision: revision };
  });
  const settingsClient = options.client || createSettlementNameClient({ getSnapshot: async () => ({ settlementNameSettings: current, settlementNameRevision: revision }), writeOperation });
  await settingsClient.hydrate({ forceFresh: true });
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  editor = openSettlementNameEditor({ nodeId: "settlement-names", output: options.output || "left", citycode: "0067", settingsClient, catalog, document, restoreFocus: () => opener.focus(), onSelection: options.onSelection || (() => {}), onClose: options.onClose || (() => {}) });
  return { writeOperation, settingsClient, opener, current: () => current };
}

function frame() { return document.querySelector("iframe"); }
function send(data) {
  const event = new MessageEvent("message", { origin: window.location.origin, data });
  Object.defineProperty(event, "source", { value: frame().contentWindow });
  window.dispatchEvent(event);
}
function armFrame() {
  const sent = [];
  frame().contentWindow.postMessage = (message, origin) => sent.push({ message, origin });
  return sent;
}
function renderFrame(mesh = identityMesh, labels = [label(), label({ citycode: "0424", text: "מחוץ", x: 800, y: 400, inkBox: { left: 760, top: 380, right: 840, bottom: 420 } })], warnings = { clipped: false, overlap: false, outOfView: false, mapping: "complete" }) {
  const sent = armFrame();
  const output = new URL(frame().src).searchParams.get("span");
  const sessionId = new URL(frame().src).searchParams.get("previewSession");
  send({ type: "otef_settlement_preview_ready", sessionId, output });
  const requestId = sent.at(-1).message.requestId;
  send({ type: "otef_settlement_preview_rendered", sessionId, requestId, output, calibrationRevision: 8, meshIdentity: `mesh-${sessionId}`, mesh, labels, warnings });
  return { sent, output, sessionId, requestId };
}

function pointer(type, x, y, pointerId = 1) {
  const hit = document.querySelector(".settlement-body-hit");
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { button: 0, pointerId, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
  (type === "pointerdown" ? hit : document).dispatchEvent(event);
}

test("completed drag commits once and cancel restores the draft with zero commits", async () => {
  const { writeOperation, settingsClient } = await rig();
  renderFrame();
  pointer("pointerdown", 250, 170);
  pointer("pointermove", 290, 170);
  pointer("pointerup", 290, 170);
  await vi.waitFor(() => expect(writeOperation).toHaveBeenCalledTimes(1));
  expect(writeOperation.mock.calls[0][0]).toMatchObject({ operation: "position", output: "left", citycode: "0067", position: { x: 580, y: 340 } });
  writeOperation.mockClear();
  renderFrame();
  pointer("pointerdown", 290, 170);
  pointer("pointermove", 330, 170);
  document.dispatchEvent(Object.assign(new Event("pointercancel"), { pointerId: 1 }));
  expect(writeOperation).not.toHaveBeenCalled();
  expect(settingsClient.getTarget({ kind: "position", output: "left", citycode: "0067" }).draft).toBeNull();
  expect(document.querySelector(".settlement-name-dialog [data-field='x']").value).toBe("580");
});

test("reversed orientation maps a rightward drag back toward the source", async () => {
  const { writeOperation } = await rig();
  renderFrame(reversedMesh, [label({ x: 1420, y: 340, inkBox: { left: 1390, top: 320, right: 1450, bottom: 360 } })]);
  pointer("pointerdown", 250, 170);
  pointer("pointermove", 290, 170);
  pointer("pointerup", 290, 170);
  await vi.waitFor(() => expect(writeOperation).toHaveBeenCalledTimes(1));
  expect(writeOperation.mock.calls[0][0].position.x).toBeLessThan(1420);
});

test("rotated outline splits where it crosses mesh triangles", async () => {
  await rig();
  const wide = label({ x: 960, y: 540, rotateDeg: 25, inkBox: { left: 700, top: 500, right: 1220, bottom: 580 } });
  renderFrame(splitMesh, [wide]);
  expect(document.querySelectorAll(".settlement-outline").length).toBeGreaterThan(4);
  expect(document.querySelectorAll(".settlement-outline").length).toBe(settlementOutline(splitMesh, wide).length);
});

test("foreign pointer cannot take over an active gesture", async () => {
  const { writeOperation } = await rig();
  renderFrame();
  pointer("pointerdown", 250, 170, 4);
  pointer("pointermove", 330, 170, 9);
  pointer("pointerup", 330, 170, 9);
  expect(writeOperation).not.toHaveBeenCalled();
  pointer("pointerup", 290, 170, 4);
  await vi.waitFor(() => expect(writeOperation).toHaveBeenCalledTimes(1));
  expect(writeOperation.mock.calls[0][0].position.x).toBe(580);
});

test("resize and calibration drop handles until a new session renders", async () => {
  const { settingsClient } = await rig();
  const first = renderFrame();
  expect(document.querySelector(".settlement-outline")).not.toBeNull();
  window.dispatchEvent(new Event("resize"));
  expect(document.querySelector(".settlement-outline")).toBeNull();
  const second = new URL(frame().src).searchParams.get("previewSession");
  expect(second).not.toBe(first.sessionId);
  send({ type: "otef_settlement_preview_rendered", sessionId: first.sessionId, requestId: 1, output: "left", calibrationRevision: 8, meshIdentity: "stale", mesh: identityMesh, labels: [label()], warnings: { clipped: false, overlap: false, outOfView: false, mapping: "complete" } });
  expect(document.querySelector(".settlement-outline")).toBeNull();
  editor.calibrationChanged({ revision: 9 });
  expect(new URL(frame().src).searchParams.get("previewSession")).not.toBe(second);
  expect(settingsClient.getTarget({ kind: "position", output: "left", citycode: "0067" }).status).toBe("Saved");
});

test("retry creates a new session and an old rendered request stays rejected", async () => {
  await rig();
  const first = renderFrame();
  document.querySelector(".settlement-preview-retry").click();
  const next = new URL(frame().src).searchParams.get("previewSession");
  expect(next).not.toBe(first.sessionId);
  send({ type: "otef_settlement_preview_rendered", sessionId: first.sessionId, requestId: first.requestId, output: "left", calibrationRevision: 8, meshIdentity: "old", mesh: identityMesh, labels: [label()], warnings: { clipped: false, overlap: false, outOfView: false, mapping: "complete" } });
  expect(document.querySelector(".settlement-outline")).toBeNull();
});

test("output switch keeps the other side draft and save identity", async () => {
  vi.useFakeTimers();
  const { writeOperation, settingsClient } = await rig();
  renderFrame();
  const input = document.querySelector(".settlement-name-dialog [data-field='x']");
  input.value = "640";
  input.dispatchEvent(new Event("input")); input.dispatchEvent(new Event("change"));
  const select = document.querySelector(".settlement-name-dialog [data-field='output']");
  select.value = "right";
  select.dispatchEvent(new Event("change"));
  expect(frame().src).toContain("span=right");
  expect(settingsClient.getTarget({ kind: "position", output: "left", citycode: "0067" }).draft).toEqual({ x: 640, y: 340 });
  await vi.advanceTimersByTimeAsync(150);
  expect(writeOperation.mock.calls[0][0]).toMatchObject({ output: "left", citycode: "0067", position: { x: 640, y: 340 } });
});

test("closing while a numeric save is pending still flushes that commit and drops the gesture", async () => {
  vi.useFakeTimers();
  const { writeOperation } = await rig();
  renderFrame();
  const input = document.querySelector(".settlement-name-dialog [data-field='x']");
  input.value = "";
  input.dispatchEvent(new Event("input")); input.dispatchEvent(new Event("change"));
  input.value = "700";
  input.dispatchEvent(new Event("input")); input.dispatchEvent(new Event("change"));
  pointer("pointerdown", 250, 170);
  pointer("pointermove", 400, 170);
  editor.close();
  editor = null;
  expect(document.querySelector("iframe")).toBeNull();
  expect(writeOperation).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);
  expect(writeOperation).toHaveBeenCalledTimes(1);
  expect(writeOperation.mock.calls[0][0].position).toEqual({ x: 700, y: 340 });
});

test("escape closes and restores focus while mapping errors keep numeric source coordinates", async () => {
  const { opener, writeOperation } = await rig();
  renderFrame();
  pointer("pointerdown", -20, 170);
  const mapping = document.querySelector(".settlement-name-mapping");
  expect(mapping.textContent).toMatch(/Mapping unavailable/);
  expect(mapping.textContent).toMatch(/500/);
  expect(document.querySelector("[data-field='x']").disabled).toBe(false);
  expect(writeOperation).not.toHaveBeenCalled();
  document.querySelector(".settlement-name-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector(".settlement-name-dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  editor = null;
});

test("clipping and overlap warnings stay visible without moving the saved center", async () => {
  const { writeOperation } = await rig();
  renderFrame(identityMesh, [label()], { clipped: true, overlap: true, outOfView: true, mapping: "complete" });
  const warning = document.querySelector(".settlement-name-warning").textContent;
  expect(warning).toMatch(/clip/i);
  expect(warning).toMatch(/overlap/i);
  expect(warning).toMatch(/outside/i);
  expect(writeOperation).not.toHaveBeenCalled();
  expect(document.querySelector("[data-field='x']").value).toBe("500");
});

test("iframe and overlay share a contained 1920x1080 plane so the box sits on the rendered name", async () => {
  const { writeOperation } = await rig({ bounds: { left: 0, top: 0, width: 1000, height: 400, right: 1000, bottom: 400, x: 0, y: 0 } });
  renderFrame();
  const plane = document.querySelector(".settlement-name-reference-plane");
  const overlay = document.querySelector(".settlement-name-overlay");
  const scale = 400 / 1080;
  const left = (1000 - 1920 * scale) / 2;
  expect(plane.contains(document.querySelector("iframe"))).toBe(true);
  expect(plane.contains(overlay)).toBe(true);
  expect(overlay.getAttribute("viewBox")).toBe("0 0 1920 1080");
  expect(plane.style.transform).toBe(`translate(${left}px, 0px) scale(${scale})`);
  pointer("pointerdown", left + 500 * scale, 340 * scale);
  pointer("pointermove", left + 540 * scale, 340 * scale);
  pointer("pointerup", left + 540 * scale, 340 * scale);
  await vi.waitFor(() => expect(writeOperation).toHaveBeenCalledTimes(1));
  expect(writeOperation.mock.calls[0][0].position.x).toBeCloseTo(540, 5);
});

test("Retry resubmits a conflicted shared style from the modal", async () => {
  const retained = { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 40 };
  const server = settingsFixture();
  server.style = { ...retained, rotateDeg: 12 };
  const writeOperation = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error("Failed to execute command: 409"), {
      status: 409,
      details: { error: "conflict", settlementNameSettings: structuredClone(server), settlementNameRevision: 2 },
    }))
    .mockImplementation(async (body) => {
      if (body.operation === "style") server.style = { ...body.style };
      return { status: "ok", settlementNameSettings: structuredClone(server), settlementNameRevision: body.baseRevision + 1 };
    });
  const settingsClient = createSettlementNameClient({
    getSnapshot: async () => ({ settlementNameSettings: settingsFixture(), settlementNameRevision: 1 }),
    writeOperation,
  });
  await settingsClient.hydrate({ forceFresh: true });
  await expect(settingsClient.commit({ kind: "style" }, retained)).rejects.toMatchObject({ status: 409 });
  expect(settingsClient.getTarget({ kind: "style" }).status).toBe("Conflict");
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  editor = openSettlementNameEditor({
    nodeId: "settlement-names",
    output: "left",
    citycode: "0067",
    settingsClient,
    catalog,
    document,
    restoreFocus: () => opener.focus(),
  });
  expect(document.querySelector(".settlement-name-status").textContent).toBe("Changed on another screen");
  document.querySelector(".settlement-name-retry").click();
  await vi.waitFor(() => expect(writeOperation).toHaveBeenCalledTimes(2));
  expect(writeOperation.mock.calls[1][0]).toMatchObject({ operation: "style", style: retained });
  await vi.waitFor(() => expect(document.querySelector(".settlement-name-status").textContent).toBe("Saved"));
});
