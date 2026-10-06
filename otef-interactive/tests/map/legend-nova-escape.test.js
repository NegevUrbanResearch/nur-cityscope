import { describe, expect, it, vi } from "vitest";
import { buildLegendModel } from "../../frontend/src/map/legend-model-builder.js";
import { mountMapLegend } from "../../frontend/src/map/map-legend.js";
import { installMapLegendLifecycle } from "../../frontend/src/map/legend-integration.js";
import { createProjectionLegendAdapter } from "../../frontend/src/projection/projection-legend-adapter.js";

function fixture() {
  const state = { narrative: { id: "nova" }, overlay: { individual: true, overlap: false } };
  const callbacks = new Map();
  const dataContext = {
    getLayerGroups: () => [{ id: "nli", layers: [] }],
    getNarrativeState: () => state.narrative,
    getEscapeOverlay: () => state.overlay,
    getLegendSettings: () => ({ language: "en" }),
    subscribe(topic, callback) { callbacks.set(topic, callback); return () => callbacks.delete(topic); },
  };
  const registry = { _initialized: true, getLayerConfig: () => null };
  return { state, callbacks, dataContext, registry };
}

describe("Nova fleeing route legend", () => {
  it.each(["gis", "projection"])("%s shows one bilingual ribbon item only for enabled Nova routes", async (surface) => {
    const f = fixture();
    const build = (language = "en") => buildLegendModel({ ...f, surface, language });
    const model = await build();
    expect(model.packs).toHaveLength(1);
    expect(model.packs[0].id).toBe("nli");
    expect(model.packs[0].layers).toHaveLength(1);
    expect(model.packs[0].layers[0].items[0]).toMatchObject({ label: "Fleeing routes", shape: "line", strokeOpacity: 0.6 });
    expect((await build("he")).packs[0].layers[0].items[0].label).toBe("צירי בריחה");
    f.state.overlay.overlap = true;
    expect((await build()).packs[0].layers).toHaveLength(1);
    expect((await build()).packs[0].layers[0].items[0].strokeOpacity).toBe(1);
    f.state.overlay.individual = false;
    expect((await build()).packs[0].layers).toHaveLength(1);
    f.state.overlay.overlap = false;
    expect((await build()).packs).toEqual([]);
    f.state.overlay.individual = true;
    f.state.narrative.id = "segev";
    expect((await build()).packs).toEqual([]);
  });

  it.each(["gis", "projection"])("%s updates its rendered legend when fleeing routes toggle", async (surface) => {
    const f = fixture();
    const element = { clientWidth: 700, clientHeight: 400, innerHTML: "", classList: { toggle() {} } };
    const lifecycle = installMapLegendLifecycle({ ...f, element, surface, projectionSpan: "left" });
    await vi.waitFor(() => expect(element.innerHTML).toContain("Fleeing routes"));
    expect(element.innerHTML).toContain("linear-gradient(180deg, #f5f500 0%, #f5f500 12.5%, #f50000 87.5%, #f50000 100%)");
    f.state.overlay.individual = false;
    f.callbacks.get("escapeOverlay")?.(f.state.overlay);
    await vi.waitFor(() => expect(element.innerHTML).not.toContain("Fleeing routes"));
    lifecycle.dispose();
    expect(f.callbacks.size).toBe(0);
  });

  it("paints the projection ribbon gradient across the stroke width", async () => {
    const f = fixture();
    const element = { clientWidth: 700, clientHeight: 400, innerHTML: "", classList: { toggle() {} } };
    const legend = mountMapLegend({ ...f, element, surface: "projection", projectionSpan: "left" });
    await legend.refresh();
    const gradient = { addColorStop: vi.fn() };
    const context = new Proxy({ createLinearGradient: vi.fn(() => gradient), stroke: vi.fn() }, {
      get: (target, key) => key in target ? target[key] : () => {},
    });
    const adapter = createProjectionLegendAdapter({ canvasFactory: () => ({ getContext: () => context }) });
    adapter.sync(legend.getRenderSnapshot()); adapter.draw();
    expect(context.createLinearGradient).toHaveBeenCalledTimes(1);
    const [x1, y1, x2, y2] = context.createLinearGradient.mock.calls[0];
    expect(x1).toBe(x2);
    expect(y2).toBeGreaterThan(y1);
    expect(gradient.addColorStop.mock.calls).toEqual([[0, "#f5f500"], [0.125, "#f5f500"], [0.875, "#f50000"], [1, "#f50000"]]);
    expect(context.strokeStyle).toBe(gradient);
    expect(context.globalAlpha).toBe(0.6);
    adapter.dispose(); legend.dispose();
  });
});
