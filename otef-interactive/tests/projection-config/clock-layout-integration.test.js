// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { mountProjectionConfig } from "../../frontend/src/projection-config/config-controller.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createClockLayoutClient } from "../../frontend/src/projection-config/clock-layout-client.js";

let mounted;
afterEach(() => { mounted?.dispose(); mounted = null; document.body.replaceChildren(); vi.useRealTimers(); });

function mount(overrides = {}) {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const state = { snapshot: { revision: 1, config, presets: [], selectedPresetId: null }, draft: config,
    live: false, pending: false, connected: true, hasLocalDraft: false };
  const client = { getState: () => state, subscribe(listener) { listener(state); return () => {}; },
    start: async () => state, stop() {}, setValidateCandidate() {}, setDraft: vi.fn(), setLive() {} };
  const layout = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  const layoutClient = overrides.layoutClient || { getSlot: () => ({ acknowledged: layout, draft: null, status: "Saved" }),
    subscribe: () => () => {}, commit: vi.fn() };
  const root = document.createElement("main"); document.body.appendChild(root);
  mounted = mountProjectionConfig(root, { client, layoutClient });
  return { root, layoutClient, client };
}

test.each(["failure", "conflict"])("closed editor shows %s and recovery on the selected clock node and inspector with zero frames", async (kind) => {
  vi.useFakeTimers();
  const layout = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  let current = { nli_clock_layout: { gis: { start: layout, nova: { ...layout, leftPct: 12 } }, projection: { left: layout } }, nli_clock_layout_revision: 0,
    legend_settings: { projection: { left: { ...layout, dwellSeconds: 8 } } }, legend_layout_revision: 0 };
  const getSnapshot = vi.fn(async () => current);
  const writeClockSlot = vi.fn(async () => {
    if (kind === "failure") throw new Error("offline");
    current = { ...current, nli_clock_layout: { ...current.nli_clock_layout, gis: { ...current.nli_clock_layout.gis, start: { ...layout, leftPct: 11 } } }, nli_clock_layout_revision: 1 };
    return { error: "conflict", status: 409, nliClockLayout: current.nli_clock_layout, nliClockLayoutRevision: 1 };
  });
  const layoutClient = createClockLayoutClient({ getSnapshot, writeClockSlot }); await layoutClient.hydrate();
  try {
    const { root } = mount({ layoutClient });
    const node = root.querySelector('[data-node="clock-gis"]'); node.click();
    const inspector = root.querySelector(".clock-settings-inspector");
    const x = inspector.querySelector('[data-field="leftPct"]');
    expect(x).not.toBeNull(); expect(document.querySelectorAll("iframe")).toHaveLength(0);
    node.querySelector('[data-action="clock-editor-open"]').click();
    const modalX = document.querySelector('.clock-layout-dialog [data-field="leftPct"]'); modalX.value = "17"; modalX.dispatchEvent(new Event("change"));
    document.querySelector(".clock-layout-close").click();
    await vi.advanceTimersByTimeAsync(150);
    const text = kind === "failure" ? "Save failed" : "Changed on another screen";
    expect(inspector.querySelector(".clock-layout-status").textContent).toBe(text);
    expect(node.querySelector(".clock-layout-status").textContent).toBe(text);
    expect(inspector.querySelector(".clock-layout-retry").hidden).toBe(false);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    const scene = inspector.querySelector('select[aria-label="GIS clock preview scene"]'); scene.value = "nova"; scene.dispatchEvent(new Event("change"));
    expect(x.value).toBe("12"); expect(inspector.querySelector(".clock-layout-status").textContent).toBe("Saved");
    scene.value = "home"; scene.dispatchEvent(new Event("change"));
    expect(x.value).toBe("17"); expect(inspector.querySelector(".clock-layout-status").textContent).toBe(text);
    if (kind === "conflict") { inspector.querySelector(".clock-layout-load").click(); expect(x.value).toBe("11"); }
    else { inspector.querySelector(".clock-layout-retry").click(); await vi.advanceTimersByTimeAsync(0); expect(getSnapshot).toHaveBeenLastCalledWith({ forceFresh: true }); }
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  } finally { layoutClient.destroy(); }
});

test.each(["saved", "load"])("inspector-only drafts protect unload across slot switches until %s", async (completion) => {
  vi.useFakeTimers();
  const layout = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  const snapshot = { nli_clock_layout: { gis: { start: layout, nova: layout }, projection: {} }, nli_clock_layout_revision: 0, legend_settings: { projection: {} }, legend_layout_revision: 0 };
  const layoutClient = createClockLayoutClient({ getSnapshot: async () => snapshot, writeClockSlot: async ({ layout, baseRevision }) => {
    if (completion === "load") throw new Error("offline");
    return { status: "ok", nliClockLayout: { ...snapshot.nli_clock_layout, gis: { ...snapshot.nli_clock_layout.gis, start: layout } }, nliClockLayoutRevision: baseRevision + 1 };
  } }); await layoutClient.hydrate();
  try {
    const { root } = mount({ layoutClient }); root.querySelector('[data-node="clock-gis"]').click();
    const inspector = root.querySelector(".clock-settings-inspector");
    const input = inspector.querySelector('[data-field="leftPct"]'); input.value = "17"; input.dispatchEvent(new Event("change"));
    const scene = inspector.querySelector('select[aria-label="GIS clock preview scene"]'); scene.value = "nova"; scene.dispatchEvent(new Event("change"));
    const unload = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
    expect(unload()).toBe(true); expect(document.querySelectorAll("iframe")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    if (completion === "load") {
      expect(unload()).toBe(true); scene.value = "home"; scene.dispatchEvent(new Event("change"));
      layoutClient.loadSaved("gisClock", "start");
    }
    expect(unload()).toBe(false); mounted.dispose(); expect(unload()).toBe(false);
  } finally { layoutClient.destroy(); }
});

test("actual warp and clock editors are exclusive across graph, Enter and mobile entry", () => {
  const { root, layoutClient, client } = mount();
  const warpOpen = root.querySelector('[data-node="left-keystone"] [data-action="warp-editor-open"]');
  warpOpen.click();
  expect(root.querySelector(".warp-editor-dialog").hidden).toBe(false);
  const clockNode = root.querySelector('[data-node="clock-gis"]');
  clockNode.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(root.querySelector(".warp-editor-dialog").hidden).toBe(true);
  expect(document.querySelectorAll(".clock-layout-dialog")).toHaveLength(1);
  document.querySelector(".clock-layout-close").click();
  warpOpen.click();
  expect(document.querySelector(".clock-layout-dialog")).toBeNull();
  expect(root.querySelector(".warp-editor-dialog").hidden).toBe(false);
  const picker = root.querySelector(".node-selector"); picker.value = "clock-projection"; picker.dispatchEvent(new Event("change"));
  root.querySelector('[data-action="warp-editor-open-mobile"]').click();
  expect(root.querySelector(".warp-editor-dialog").hidden).toBe(true);
  expect(document.querySelectorAll(".clock-layout-dialog")).toHaveLength(1);
  expect(document.querySelectorAll(".clock-layout-dialog iframe")).toHaveLength(1);
  expect(layoutClient.commit).not.toHaveBeenCalled();
  expect(client.setDraft).not.toHaveBeenCalled();
});

test("node, inspector and editor selection stay synchronized without changing the selected node or writing", () => {
  const { root, layoutClient } = mount();
  root.querySelector('[data-node="clock-gis"] [data-action="clock-editor-open"]').click();
  const nodeScene = root.querySelector('[data-node="clock-gis"] [data-action="clock-scene"]');
  const inspectorScene = root.querySelector('.clock-settings-inspector select[aria-label="GIS clock preview scene"]');
  const editorScene = document.querySelector('.clock-layout-dialog select[aria-label="GIS clock preview scene"]');
  editorScene.value = "nova"; editorScene.dispatchEvent(new Event("change"));
  expect(nodeScene.value).toBe("nova"); expect(inspectorScene.value).toBe("nova");
  expect(root.querySelector(".node-selector").value).toBe("clock-gis");
  inspectorScene.value = "timeline"; inspectorScene.dispatchEvent(new Event("change"));
  expect(nodeScene.value).toBe("timeline"); expect(editorScene.value).toBe("timeline");
  expect(layoutClient.commit).not.toHaveBeenCalled();
});

test("editor close restores focus to the current node opener after selection and responsive resize", () => {
  const responsiveListeners = new Set();
  let responsiveMatches = true;
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({
    get matches() { return query.includes("max-width: 1100px") ? responsiveMatches : false; },
    addEventListener(_type, listener) { if (query.includes("max-width: 1100px")) responsiveListeners.add(listener); },
    removeEventListener(_type, listener) { responsiveListeners.delete(listener); },
  });
  try {
    const { root } = mount();
    const selector = root.querySelector(".node-selector");
    selector.value = "clock-gis";
    selector.dispatchEvent(new Event("change"));
    const mobileOpener = root.querySelector('[data-action="warp-editor-open-mobile"]');
    mobileOpener.focus();
    mobileOpener.click();

    const scene = document.querySelector('.clock-layout-dialog select[aria-label="GIS clock preview scene"]');
    scene.value = "nova";
    scene.dispatchEvent(new Event("change"));
    responsiveMatches = false;
    for (const listener of responsiveListeners) listener({ matches: false });
    document.querySelector(".clock-layout-close").click();

    expect(document.activeElement).toBe(root.querySelector('[data-node="clock-gis"] [data-action="clock-editor-open"]'));
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});
