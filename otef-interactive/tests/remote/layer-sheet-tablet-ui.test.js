// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LayerSheetController, renderLayerRow } from "../../frontend/src/remote/layer-sheet-controller.js";

let controller;
let groups;
let writes;

function row(enabled = true) {
  return {
    displayLabel: "Route",
    fullLayerIds: ["october_7th.route", "october_7th.route_arrow"],
    enabled,
    layers: [{ id: "route", name: "Route", enabled, style: { animation: { type: "flow" } } }],
  };
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="layerSheet"><div class="sheet-content" id="layerPanelContent"></div></div>';
  groups = [
    { id: "land_use", name: "Land use", layers: [{ id: "a", name: "A", enabled: true }, { id: "b", name: "B", enabled: false }] },
    { id: "greens", name: "Greens", layers: [{ id: "c", name: "C", enabled: false }] },
    { id: "nli", name: "Library", layers: [{ id: "people", name: "People", enabled: true }] },
  ];
  writes = [];
  vi.stubGlobal("LayerStateHelper", { getEffectiveLayerGroups: () => groups });
  vi.stubGlobal("OTEFDataContext", {
    getAnimations: () => ({}),
    getLegendSettings: () => ({ summarizedGroupIds: [] }),
    getLayerGroups: () => groups,
    toggleGroup: async (id, enabled) => {
      writes.push({ id, enabled });
      groups.find((group) => group.id === id).layers.forEach((layer) => { layer.enabled = enabled; });
      return { ok: true };
    },
    setLayersEnabled: async (ids, enabled) => {
      writes.push({ ids, enabled });
      groups.forEach((group) => group.layers.forEach((layer) => {
        if (ids.includes(`${group.id}.${layer.id}`)) layer.enabled = enabled;
      }));
      return { ok: true };
    },
  });
  controller = Object.assign(Object.create(LayerSheetController.prototype), {
    sheet: document.getElementById("layerSheet"), focusedGroupId: "land_use", primaryTileIdsJson: null,
    _subscriptions: [],
  });
  controller.setupEventListeners();
  controller.render();
});

afterEach(() => {
  controller.destroy();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("tablet layer controls", () => {
  test("a lower layer toggle keeps the current pack scroll position, while another pack starts at the top", async () => {
    document.querySelector(".group-layers").scrollTop = 280;
    document.querySelector("[data-layers-more]").hidden = false;
    document.querySelector("button.layer-tile").click();
    await settle();
    expect(document.querySelector(".group-layers").scrollTop).toBe(280);
    expect(document.querySelector("[data-layers-more]").hidden).toBe(false);
    controller.render();
    expect(document.querySelector(".group-layers").scrollTop).toBe(280);
    controller.focusOnGroup("greens");
    expect(document.querySelector(".group-layers").scrollTop).toBe(0);
    expect(document.querySelector("[data-layers-more]").hidden).toBe(true);
  });

  test("the regular remote omits legend controls even when the pack supports a summary", () => {
    groups[0].legend = { summary: { label: "Land use" } };
    controller.render();
    expect(document.querySelector(".layer-legend-settings")).toBeNull();
    const port = document.querySelector(".group-layers");
    expect(port.tabIndex).toBe(0);
    const more = document.querySelector("[data-layers-more]");
    expect(more.tagName).toBe("BUTTON");
    expect(more.getAttribute("aria-controls")).toBe(port.id);
    expect(port.contains(more)).toBe(false);
    expect(writes).toEqual([]);
  });
  test("browsing a persistent pack list changes its layer controls without changing the display", () => {
    const packs = document.querySelector(".layers-pack-list");
    expect(packs).not.toBeNull();
    expect(packs.querySelectorAll("[data-layers-select-pack]")).toHaveLength(2);
    expect(packs.textContent).not.toContain("Library");
    packs.querySelector('[data-layers-select-pack="greens"]').click();
    expect(controller.focusedGroupId).toBe("greens");
    expect(document.querySelectorAll("button.layer-tile")).toHaveLength(1);
    expect(document.querySelector("button.layer-tile").getAttribute("data-layer-ids")).toContain("greens.c");
    expect(writes).toEqual([]);
  });

  test("the visible bulk action shows a partial pack, then changes to hiding the complete pack", async () => {
    const bulk = () => document.querySelector("button[data-layers-bulk-visibility]");
    expect(bulk()).not.toBeNull();
    expect(bulk().closest("details")).toBeNull();
    expect(document.querySelectorAll("[data-layers-bulk-visibility]")).toHaveLength(1);
    bulk().click();
    await settle();
    expect(writes).toEqual([{ id: "land_use", enabled: true }]);
    expect([...document.querySelectorAll("button.layer-tile")].every((button) => button.getAttribute("aria-pressed") === "true")).toBe(true);
    bulk().click();
    await settle();
    expect(writes.at(-1)).toEqual({ id: "land_use", enabled: false });
    expect([...document.querySelectorAll("button.layer-tile")].every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  test("layer visibility uses a native text and eye button with a sibling animation action", () => {
    const host = document.createElement("div");
    host.innerHTML = renderLayerRow(row(), { groupId: "october_7th", animations: {} });
    const button = host.querySelector("button.layer-tile");
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.querySelector(".layer-tile__state svg")).not.toBeNull();
    expect(button.querySelector("button")).toBeNull();
    expect(host.querySelector("[data-animation-toggle]").parentElement).toBe(button.parentElement);
    expect(host.querySelector("[data-animation-toggle]").getAttribute("data-animation-visibility-ids")).toBe('["october_7th.route","october_7th.route_arrow"]');
    expect(host.querySelector("input,.layer-tile__swatch")).toBeNull();
  });

  test("one native visibility click changes all merged layer ids once", async () => {
    const button = document.querySelector('[data-layer-ids="[&quot;land_use.a&quot;]"]') || document.querySelector(".layer-tile");
    button.click();
    await settle();
    expect(writes).toEqual([{ ids: ["land_use.a"], enabled: false }]);
    expect(document.querySelector(".layer-tile").getAttribute("aria-pressed")).toBe("false");
  });
});
