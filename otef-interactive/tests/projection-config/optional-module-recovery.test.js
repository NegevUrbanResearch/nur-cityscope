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

async function mountSettlementConfigFixture(options = {}) {
  window.history.replaceState({}, "", "/frontend/projection-config.html");
  const root = document.createElement("main");
  document.body.append(root);
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const state = { snapshot: { revision: 1, config, presets: [], selectedPresetId: null }, draft: structuredClone(config), live: false, pending: false, connected: true, hasLocalDraft: false };
  const projectionClient = { getState: () => state, subscribe(listener) { listener(state); return () => {}; }, start: async () => state, stop() {}, setValidateCandidate() {}, setDraft: vi.fn(), setLive() {} };
  const layout = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  const layoutClient = { getSlot: () => ({ acknowledged: layout, draft: null, status: "Saved" }), subscribe: () => () => {}, commit: vi.fn(), hydrate: vi.fn(async () => {}), hasUnsavedWork: () => false, getHydrationState: () => ({ status: "Saved" }) };
  let revision = 1;
  let current = settingsFixture();
  const writeOperation = vi.fn(async (body) => {
    revision += 1;
    if (body.operation === "position") current.outputs[body.output][body.citycode] = { ...body.position };
    return { status: "ok", settlementNameSettings: structuredClone(current), settlementNameRevision: revision };
  });
  const settlementClient = createSettlementNameClient({ getSnapshot: async () => ({ settlementNameSettings: structuredClone(current), settlementNameRevision: revision }), writeOperation });
  await settlementClient.hydrate({ forceFresh: true });
  mounted = mountProjectionConfig(root, { client: projectionClient, layoutClient, settlementClient, catalog, ...options });
  const app = {
    root, writeOperation, settlementClient, layoutClient,
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

test("failed settings Retry starts hydration while the catalog is empty", async () => {
 const app = await mountSettlementConfigFixture();
 vi.spyOn(app.settlementClient,"getHydrationState").mockReturnValue({status:"Failed",error:"settings offline"});
 const hydrate=vi.spyOn(app.settlementClient,"hydrate");
 mounted.setSettlementCatalog({entries:[]},{status:"loading"});
 const retry=app.root.querySelector(".settlement-name-retry"); expect(retry.hidden).toBe(false); retry.click();
 try { expect(hydrate).toHaveBeenCalledWith({forceFresh:true}); expect(app.writeOperation).not.toHaveBeenCalled(); } finally { app.settlementClient.destroy(); }
});
test("open editor Retry starts failed settings hydration with no catalog choice", async () => {
 const app=await mountSettlementConfigFixture({catalog:{entries:[]}});
 vi.spyOn(app.settlementClient,"getHydrationState").mockReturnValue({status:"Failed",error:"settings offline"});
 const hydrate=vi.spyOn(app.settlementClient,"hydrate"); mounted.setSettlementCatalog(catalog,{status:"ready"}); await app.openEditor();
 const retry=document.querySelector(".settlement-name-dialog .settlement-name-retry"); expect(retry.hidden).toBe(false); retry.click();
 try { expect(hydrate).toHaveBeenCalledWith({forceFresh:true}); expect(app.writeOperation).not.toHaveBeenCalled(); } finally { app.settlementClient.destroy(); }
});
test("open editor tracks catalog loading, error, Retry, and recovery", async () => {
 const retryCatalog=vi.fn(); const app=await mountSettlementConfigFixture({catalogStatus:{status:"error",error:"catalog offline"},retrySettlementCatalog:retryCatalog}); await app.openEditor();
 const status=document.querySelector(".settlement-name-dialog .settlement-catalog-status"); const retry=document.querySelector(".settlement-name-dialog .settlement-catalog-retry");
 try {
   expect(status.hidden).toBe(false); expect(status.textContent).toContain("catalog offline"); expect(retry.hidden).toBe(false);
   retry.click(); expect(retryCatalog).toHaveBeenCalledOnce();
   mounted.setSettlementCatalog(catalog,{status:"loading"}); expect(status.hidden).toBe(false); expect(status.textContent).toContain("Loading settlement list"); expect(retry.hidden).toBe(true);
   mounted.setSettlementCatalog(catalog,{status:"error",error:"still offline"}); expect(status.textContent).toContain("still offline"); expect(retry.hidden).toBe(false);
   mounted.setSettlementCatalog(catalog,{status:"ready"}); expect(status.hidden).toBe(true); expect(retry.hidden).toBe(true);
 } finally { app.settlementClient.destroy(); }
});

test("active compact warp, focused warp, and scalar editors expose independent optional recovery", async () => {
 const priorWidth=window.innerWidth; Object.defineProperty(window,"innerWidth",{configurable:true,value:1440});
 const retrySettlementCatalog=vi.fn(); const app=await mountSettlementConfigFixture({catalogStatus:{status:"error",error:"catalog offline"},retrySettlementCatalog});
 vi.spyOn(app.layoutClient,"getHydrationState").mockReturnValue({status:"Failed",error:"clock offline"});
 vi.spyOn(app.settlementClient,"getHydrationState").mockReturnValue({status:"Failed",error:"settings offline"});
 const hydrateSettlement=vi.spyOn(app.settlementClient,"hydrate");
 app.selectNode("left-grid");
 app.root.querySelector("[data-action='warp-editor-open']").click();
 const route=app.root.querySelector(".warp-editor-dialog .projection-optional-health");
 try {
   expect(route).not.toBeNull();
   expect(app.root.querySelector(".warp-editor-dialog").dataset.fullViewport).toBe("false");
   expect(route.textContent).toContain("clock offline");
   expect(route.textContent).toContain("settings offline");
   expect(route.textContent).toContain("catalog offline");
   route.querySelector("[data-action='retry-clock-settings']").click();
   route.querySelector("[data-action='retry-settlement-settings']").click();
   route.querySelector("[data-action='retry-settlement-catalog']").click();
   expect(app.layoutClient.hydrate).toHaveBeenCalledWith({forceFresh:true});
   expect(hydrateSettlement).toHaveBeenCalledWith({forceFresh:true});
   expect(retrySettlementCatalog).toHaveBeenCalledOnce();
   app.root.querySelector("[data-action='warp-full-viewport']").click();
   expect(app.root.querySelector(".warp-editor-dialog").dataset.fullViewport).toBe("true");
   expect(route.textContent).toContain("clock offline"); expect(route.textContent).toContain("settings offline"); expect(route.textContent).toContain("catalog offline");
   route.querySelector("[data-action='retry-clock-settings']").click();
   route.querySelector("[data-action='retry-settlement-settings']").click();
   route.querySelector("[data-action='retry-settlement-catalog']").click();
   expect(app.layoutClient.hydrate).toHaveBeenCalledTimes(2); expect(hydrateSettlement).toHaveBeenCalledTimes(2); expect(retrySettlementCatalog).toHaveBeenCalledTimes(2);
   app.root.querySelector("[data-action='warp-editor-close']").click();
   app.selectNode("left-crop"); app.root.querySelector(".config-editor-region > .config-enlarge-edit").click();
   const compactScalar=app.root.querySelector(".parameter-editor-dialog .projection-optional-health");
   expect(compactScalar).toBe(route); expect(compactScalar.textContent).toContain("clock offline");
   compactScalar.querySelector("[data-action='retry-settlement-settings']").click();
   expect(hydrateSettlement).toHaveBeenCalledTimes(3);
   expect(app.writeOperation).not.toHaveBeenCalled();
 } finally { app.settlementClient.destroy(); Object.defineProperty(window,"innerWidth",{configurable:true,value:priorWidth}); }
});

test("reopening focused warp restores the shared optional recovery surface", async () => {
 const priorWidth = window.innerWidth;
 Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
 const retrySettlementCatalog = vi.fn();
 const app = await mountSettlementConfigFixture({ catalogStatus: { status: "error", error: "catalog offline" }, retrySettlementCatalog });
 try {
  app.selectNode("left-grid");
  app.root.querySelector("[data-action='warp-editor-open']").click();
  const health = app.root.querySelector(".warp-editor-dialog .projection-optional-health");
  expect(health).not.toBeNull();
  app.root.querySelector("[data-action='warp-editor-close']").click();
  app.root.querySelector("[data-action='warp-editor-open']").click();
  expect(app.root.querySelector(".warp-editor-dialog").dataset.fullViewport).toBe("true");
  expect(app.root.querySelector(".warp-editor-dialog .projection-optional-health")).toBe(health);
  expect(health.textContent).toContain("catalog offline");
  health.querySelector("[data-action='retry-settlement-catalog']").click();
  expect(retrySettlementCatalog).toHaveBeenCalledOnce();
  expect(app.writeOperation).not.toHaveBeenCalled();
 } finally { app.settlementClient.destroy(); Object.defineProperty(window, "innerWidth", { configurable: true, value: priorWidth }); }
});

test("closing a scalar editor before opening warp restores health inside the warp route", async () => {
 const priorWidth = window.innerWidth;
 Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
 const retrySettlementCatalog = vi.fn();
 const app = await mountSettlementConfigFixture({ catalogStatus: { status: "error", error: "catalog offline" }, retrySettlementCatalog });
 try {
  app.selectNode("left-crop");
  app.root.querySelector(".config-editor-region > .config-enlarge-edit").click();
  const health = app.root.querySelector(".parameter-editor-dialog .projection-optional-health");
  expect(health).not.toBeNull();
  app.root.querySelector("[data-action='parameter-editor-close']").click();
  app.selectNode("left-grid");
  app.root.querySelector("[data-action='warp-editor-open']").click();
  expect(app.root.querySelector(".warp-editor-dialog .projection-optional-health")).toBe(health);
  expect(health.textContent).toContain("catalog offline");
  health.querySelector("[data-action='retry-settlement-catalog']").click();
  expect(retrySettlementCatalog).toHaveBeenCalledOnce();
  expect(app.writeOperation).not.toHaveBeenCalled();
 } finally { app.settlementClient.destroy(); Object.defineProperty(window, "innerWidth", { configurable: true, value: priorWidth }); }
});
