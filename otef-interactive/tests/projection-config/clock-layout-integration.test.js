// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { mountProjectionConfig } from "../../frontend/src/projection-config/config-controller.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";

let mounted;
afterEach(() => { mounted?.dispose(); mounted = null; document.body.replaceChildren(); });

function mount() {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const state = { snapshot: { revision: 1, config, presets: [], selectedPresetId: null }, draft: config,
    live: false, pending: false, connected: true, hasLocalDraft: false };
  const client = { getState: () => state, subscribe(listener) { listener(state); return () => {}; },
    start: async () => state, stop() {}, setValidateCandidate() {}, setDraft: vi.fn(), setLive() {} };
  const layout = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  const layoutClient = { getSlot: () => ({ acknowledged: layout, draft: null, status: "Saved" }),
    subscribe: () => () => {}, commit: vi.fn() };
  const root = document.createElement("main"); document.body.appendChild(root);
  mounted = mountProjectionConfig(root, { client, layoutClient });
  return { root, layoutClient, client };
}

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
