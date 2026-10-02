// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { mountProjectionConfig } from "../../frontend/src/projection-config/config-controller.js";
import { createSettlementNameClient } from "../../frontend/src/projection-config/settlement-name-client.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { layoutNodePositions } from "../../frontend/src/projection-config/node-canvas.js";

const catalog = { entries: [{ citycode: "0067", text: "נירים", lng: 34.4, lat: 31.3 }] };
let mounted;
afterEach(() => { mounted?.dispose(); mounted = null; document.body.replaceChildren(); vi.useRealTimers(); });

function settingsFixture() {
  return {
    baseline: {
      captureId: "fixture-settlement-name", captureDigest: "a".repeat(64), sourceDigest: "b".repeat(64), catalogDigest: "c".repeat(64),
      predecessor: { revision: 1, configDigest: "d".repeat(64) }, successor: { revision: 2, configDigest: "e".repeat(64) },
      outputs: { left: { "0067": { x: 510, y: 350 } }, right: { "0067": { x: 1200, y: 360 } } },
    },
    style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
    outputs: { left: {}, right: {} },
  };
}

async function mountSettlementConfigFixture() {
  window.history.replaceState({}, "", "/frontend/projection-config.html");
  const root = document.createElement("main");
  document.body.append(root);
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const state = { snapshot: { revision: 1, config, presets: [], selectedPresetId: null }, draft: structuredClone(config), live: false, pending: false, connected: true, hasLocalDraft: false };
  const projectionClient = { getState: () => state, subscribe(listener) { listener(state); return () => {}; }, start: async () => state, stop() {}, setValidateCandidate() {}, setDraft: vi.fn(), setLive() {} };
  const layout = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  const layoutClient = { getSlot: () => ({ acknowledged: layout, draft: null, status: "Saved" }), subscribe: () => () => {}, commit: vi.fn(), hasUnsavedWork: () => false, getHydrationState: () => ({ status: "Saved" }) };
  let revision = 1;
  let current = settingsFixture();
  const writeOperation = vi.fn(async (body) => {
    revision += 1;
    if (body.operation === "position") current.outputs[body.output][body.citycode] = { ...body.position };
    return { status: "ok", settlementNameSettings: structuredClone(current), settlementNameRevision: revision };
  });
  const settlementClient = createSettlementNameClient({ getSnapshot: async () => ({ settlementNameSettings: structuredClone(current), settlementNameRevision: revision }), writeOperation });
  await settlementClient.hydrate({ forceFresh: true });
  mounted = mountProjectionConfig(root, { client: projectionClient, layoutClient, settlementClient, catalog });
  const app = {
    root, writeOperation, settlementClient,
    selectNode(id) { root.querySelector(`[data-node="${id}"]`).click(); },
    setOutput(output) {
      const select = root.querySelector(".settlement-name-controls [data-field='output']");
      select.value = output;
      select.dispatchEvent(new Event("change"));
    },
    setCitycode(citycode) {
      const select = root.querySelector(".settlement-name-controls [data-field='citycode']");
      select.value = citycode;
      select.dispatchEvent(new Event("change"));
    },
    async openEditor() { root.querySelector("[data-action='settlement-editor-open']").click(); },
    frameUrl() { return document.querySelector("iframe").src; },
    async closeEditor() { document.querySelector(".settlement-name-close").click(); },
  };
  return app;
}

test("opening and selecting names never writes and only one preview exists", async () => {
  const app = await mountSettlementConfigFixture();
  app.selectNode("settlement-names");
  app.setOutput("right");
  app.setCitycode("0067");
  await app.openEditor();
  expect(app.writeOperation).not.toHaveBeenCalled();
  expect(app.root.ownerDocument.querySelectorAll("iframe")).toHaveLength(1);
  expect(app.frameUrl()).toContain("span=right");
  expect(app.frameUrl()).toContain("settlementPreview=1");
  await app.closeEditor();
  expect(app.root.ownerDocument.querySelectorAll("iframe")).toHaveLength(0);
});

test("settlement names stay in the content column without a calibration edge", () => {
  const { positions } = layoutNodePositions({});
  expect(positions["settlement-names"].x).toBe(positions.content.x);
  expect(positions["settlement-names"].y).toBeGreaterThan(positions["names-wall"].y);
  expect(positions.pre.x).toBeGreaterThan(positions["settlement-names"].x);
});

test("clock and warp editors close the settlement frame", async () => {
  const app = await mountSettlementConfigFixture();
  app.selectNode("settlement-names");
  await app.openEditor();
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  app.root.querySelector("[data-node='clock-gis'] [data-action='clock-editor-open']").click();
  expect(document.querySelector(".settlement-name-dialog")).toBeNull();
  expect(document.querySelectorAll(".clock-preview-frame")).toHaveLength(1);
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  app.selectNode("settlement-names");
  await app.openEditor();
  expect(document.querySelector(".clock-layout-dialog")).toBeNull();
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  app.root.querySelector("[data-node='left-keystone'] [data-action='warp-editor-open']").click();
  expect(document.querySelector(".settlement-name-dialog")).toBeNull();
  expect(document.querySelector(".settlement-preview-frame")).toBeNull();
});

test("a closed modal keeps the pending draft and both domains warn before unload", async () => {
  vi.useFakeTimers();
  const app = await mountSettlementConfigFixture();
  app.selectNode("settlement-names");
  const input = app.root.querySelector(".settlement-name-controls [data-field='x']");
  input.value = "640";
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event("change"));
  await app.openEditor();
  await app.closeEditor();
  expect(app.root.querySelector(".settlement-name-controls [data-field='x']").value).toBe("640");
  const unload = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
  expect(unload()).toBe(true);
  await vi.advanceTimersByTimeAsync(150);
  expect(app.writeOperation).toHaveBeenCalledTimes(1);
  expect(unload()).toBe(false);
});

test("enter opens the editor and escape restores the node button", async () => {
  const app = await mountSettlementConfigFixture();
  const card = app.root.querySelector("[data-node='settlement-names']");
  card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  document.querySelector(".settlement-name-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector("iframe")).toBeNull();
  expect(document.activeElement).toBe(card.querySelector("[data-action='settlement-editor-open']"));
});

test('signed settlement input from zero saves separately and blocks a changed output', async () => {
  const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  vi.useFakeTimers(); const app=await mountSettlementConfigFixture();
  const input=app.root.querySelector('.settlement-name-controls [data-field="x"]');
  input.closest('.config-field').querySelector('[data-action="numeric-sign"]').click();
  input.value='2,5'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(150);
  expect(app.writeOperation).toHaveBeenCalledWith(expect.objectContaining({operation:'position',output:'left',position:{x:-2.5,y:350}}));
  app.writeOperation.mockClear(); input.value='25'; input.dispatchEvent(new Event('input')); app.setOutput('right');
  input.dispatchEvent(new Event('blur')); await vi.advanceTimersByTimeAsync(150);
  expect(app.writeOperation).not.toHaveBeenCalled();
  expect(input.closest('.config-field').querySelector('[data-action="numeric-use-mine"]').disabled).toBe(true);
  expect(warning).toHaveBeenCalledWith('[SettlementNameClient] position offscreen'); warning.mockRestore();
});
