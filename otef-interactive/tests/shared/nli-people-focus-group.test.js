import { describe, expect, it, vi } from "vitest";
import { applyPeopleFocusDim, clearPeopleFocusDim, forgetPeopleFocusLayers } from "../../frontend/src/shared/nli-people-focus-presentation.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { scaleOpacityExpression } from "../../frontend/src/shared/layer-opacity-expression.js";
import { applyNarrativePeopleFilter } from "../../frontend/src/map/nli-people-marker-filter.js";

const condition = ["==", ["to-string", ["get", "pid"]], "11"];
const captivity = ["match", ["get", "status"], "Murdered in captivity", 0, 1];
const foreground = (base) => ["case", condition, base, 0];
const background = (base) => ["case", condition, 0, base];

function createMap() {
  const layers = [
    { id: "base", type: "background" },
    { id: "people", type: "circle", source: "nli.people", filter: ["!=", ["get", "status"], "Kidnap survivor"], paint: { "circle-opacity": captivity, "circle-stroke-opacity": captivity, "circle-color": "red" } },
    { id: "icons", type: "symbol", source: "nli.people", paint: { "icon-opacity": 1 }, layout: { "icon-image": "captivity" } },
    { id: "labels", type: "symbol", source: "places" },
  ];
  const listeners = new Map();
  const map = {
    getStyle: () => ({ layers }),
    getLayersOrder: () => layers.map((layer) => layer.id),
    getLayer: (id) => layers.find((layer) => layer.id === id),
    getPaintProperty: (id, property) => map.getLayer(id)?.paint?.[property],
    setPaintProperty(id, property, value) { (map.getLayer(id).paint ||= {})[property] = value; },
    setLayoutProperty(id, property, value) { (map.getLayer(id).layout ||= {})[property] = value; },
    setFilter(id, filter) { map.getLayer(id).filter = filter; },
    addLayer(layer, beforeId) { const index = layers.findIndex((item) => item.id === beforeId); layers.splice(index < 0 ? layers.length : index, 0, layer); },
    removeLayer(id) { const index = layers.findIndex((layer) => layer.id === id); if (index >= 0) layers.splice(index, 1); },
    moveLayer(id, beforeId) { const layer = map.getLayer(id); map.removeLayer(id); map.addLayer(layer, beforeId); },
    on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener); },
    off(event, listener) { listeners.get(event)?.delete(listener); },
    emit(event) { for (const listener of [...(listeners.get(event) || [])]) listener(); },
    triggerRepaint: vi.fn(),
  };
  return map;
}

describe("people focus group transparency", () => {
  it("composites the native markers once and draws selected markers above the group", () => {
    const map = createMap();
    applyPeopleFocusDim(map, "11");
    const layers = map.getStyle().layers;
    expect(layers.filter((layer) => layer.type === "custom")).toHaveLength(2);
    const begin = layers.findIndex((layer) => layer.type === "custom");
    const end = layers.findLastIndex((layer) => layer.type === "custom");
    expect(layers.slice(begin + 1, end).map((layer) => layer.id)).toEqual(["people", "icons"]);
    expect(map.getPaintProperty("people", "circle-opacity")).toEqual(background(captivity));
    const copies = layers.slice(end + 1).filter((layer) => layer.source === "nli.people");
    expect(copies).toHaveLength(2);
    expect(copies[0].paint["circle-opacity"]).toEqual(foreground(captivity));
    expect(copies[0].filter).toEqual(map.getLayer("people").filter);
    expect(copies[1].layout["icon-image"]).toBe("captivity");
    expect(layers.at(-1).id).toBe("labels");
  });

  it("does not duplicate compositor layers when selection changes and restores authored paint", () => {
    const map = createMap();
    applyPeopleFocusDim(map, "11");
    applyPeopleFocusDim(map, "12");
    expect(map.getStyle().layers.filter((layer) => layer.type === "custom")).toHaveLength(2);
    clearPeopleFocusDim(map);
    expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(["base", "people", "icons", "labels"]);
    expect(map.getPaintProperty("people", "circle-opacity")).toEqual(captivity);
    expect(map.getPaintProperty("icons", "icon-opacity")).toBe(1);
  });

  it("removes foreground copies before the native source owner removes its layers", () => {
    const map = createMap();
    applyPeopleFocusDim(map, "11");
    forgetPeopleFocusLayers(map, ["people", "icons"]);
    expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(["base", "people", "icons", "labels"]);
  });

  it("tracks the lifecycle fade for the selected foreground without multiplying the group dim", () => {
    const map = createMap();
    let time = 0;
    let frame;
    const runtime = getLayerLifecycleRuntime(map, { now: () => time, requestFrame: (callback) => { frame = callback; return 1; }, cancelFrame() {}, setTimer: () => 1, clearTimer() {} });
    runtime.setDesiredIds(["nli.people"], { durationMs: 600 });
    runtime.stageMapLayer("nli.people", map.getLayer("people"));
    runtime.markMemberReady("nli.people");
    runtime.commitBatch();
    time = 300;
    frame(time);
    applyPeopleFocusDim(map, "11");
    const copy = map.getStyle().layers.find((layer) => layer.id !== "people" && layer.type === "circle");
    expect(map.getPaintProperty("people", "circle-opacity")).toEqual(scaleOpacityExpression(background(captivity), 0.5));
    expect(copy.paint["circle-opacity"]).toEqual(scaleOpacityExpression(foreground(captivity), 0.5));
    time = 600;
    frame(time);
    expect(copy.paint["circle-opacity"]).toEqual(foreground(captivity));
    clearPeopleFocusDim(map);
    expect(map.getPaintProperty("people", "circle-opacity")).toEqual(captivity);
  });

  it("keeps the current narrative filter on both native and selected marker layers", () => {
    const map = createMap();
    applyPeopleFocusDim(map, "11");
    applyNarrativePeopleFilter(map, "nova");
    for (const layer of map.getStyle().layers.filter((item) => item.source === "nli.people")) {
      expect(layer.filter).toEqual(["==", ["get", "location"], "Nova"]);
    }
    clearPeopleFocusDim(map);
    expect(map.getLayer("people").filter).toEqual(["==", ["get", "location"], "Nova"]);
  });

  it("remounts compositor and foreground layers when a style diff retains the native layer", () => {
    const map = createMap();
    applyPeopleFocusDim(map, "11");
    for (const layer of [...map.getStyle().layers]) {
      if (layer.type === "custom" || layer.id.startsWith("nli-people-focus-copy-")) map.removeLayer(layer.id);
    }
    map.emit("styledata");
    const copy = map.getStyle().layers.find((layer) => layer.id !== "people" && layer.type === "circle");
    expect(copy.paint["circle-opacity"]).toEqual(foreground(captivity));
    expect(map.getStyle().layers.filter((layer) => layer.type === "custom")).toHaveLength(2);
    clearPeopleFocusDim(map);
    expect(map.getPaintProperty("people", "circle-opacity")).toEqual(captivity);
  });

  it("waits for native layers when a selection arrives before their source is mounted", () => {
    const map = createMap();
    const people = map.getLayer("people");
    const icons = map.getLayer("icons");
    map.removeLayer("people"); map.removeLayer("icons");
    applyPeopleFocusDim(map, "11");
    expect(map.getStyle().layers).toHaveLength(2);
    map.addLayer(people, "labels"); map.addLayer(icons, "labels");
    map.emit("styledata");
    expect(map.getPaintProperty("people", "circle-opacity")).toEqual(background(captivity));
    clearPeopleFocusDim(map);
  });

  it("keeps a pending selection when an unrelated scene layer is retired before people mount", () => {
    const map = createMap();
    const people = map.getLayer("people");
    const icons = map.getLayer("icons");
    map.removeLayer("people"); map.removeLayer("icons");
    applyPeopleFocusDim(map, "11");
    forgetPeopleFocusLayers(map, ["labels"]);
    map.removeLayer("labels");
    map.addLayer(people); map.addLayer(icons);
    map.emit("styledata");
    expect(map.getPaintProperty("people", "circle-opacity")).toEqual(background(captivity));
    expect(map.getStyle().layers.filter((layer) => layer.type === "custom")).toHaveLength(2);
    clearPeopleFocusDim(map);
  });

  it("reapplies selection after the people source owner replaces all marker layers", () => {
    const map = createMap();
    const native = structuredClone([map.getLayer("people"), map.getLayer("icons")]);
    applyPeopleFocusDim(map, "11");
    forgetPeopleFocusLayers(map, ["people", "icons"]);
    map.removeLayer("people"); map.removeLayer("icons");
    map.emit("styledata");
    for (const layer of native) map.addLayer(layer);
    map.emit("styledata");
    expect(map.getPaintProperty("people", "circle-opacity")).toEqual(background(captivity));
    expect(map.getPaintProperty("nli-people-focus-copy-people", "circle-opacity")).toEqual(foreground(captivity));
    clearPeopleFocusDim(map);
  });

  it("cancels a pending selection when it is explicitly cleared before markers mount", () => {
    const map = createMap();
    const people = map.getLayer("people");
    const icons = map.getLayer("icons");
    map.removeLayer("people"); map.removeLayer("icons");
    applyPeopleFocusDim(map, "11");
    forgetPeopleFocusLayers(map, ["labels"]);
    clearPeopleFocusDim(map);
    map.addLayer(people); map.addLayer(icons);
    map.emit("styledata");
    expect(map.getPaintProperty("people", "circle-opacity")).toEqual(captivity);
    expect(map.getStyle().layers.filter((layer) => layer.type === "custom")).toHaveLength(0);
  });

  it("preserves authored opacity when serialized focused paint is restored into new native instances", () => {
    const map = createMap();
    applyPeopleFocusDim(map, "11");
    const restored = structuredClone(map.getStyle().layers.filter((layer) =>
      layer.type !== "custom" && !layer.id.startsWith("nli-people-focus-copy-")));
    for (const layer of [...map.getStyle().layers]) map.removeLayer(layer.id);
    for (const layer of restored) map.addLayer(layer);
    map.emit("styledata");
    const copy = map.getStyle().layers.find((layer) => layer.id !== "people" && layer.type === "circle");
    expect(copy.paint["circle-opacity"]).toEqual(foreground(captivity));
    clearPeopleFocusDim(map);
    expect(map.getPaintProperty("people", "circle-opacity")).toEqual(captivity);
  });

  it("does not continuously reorder layers when getStyle omits custom layers as MapLibre does", () => {
    const map = createMap();
    const readStyle = map.getStyle;
    map.getStyle = () => ({ layers: readStyle().layers.filter((layer) => layer.type !== "custom") });
    const move = vi.spyOn(map, "moveLayer");
    applyPeopleFocusDim(map, "11");
    move.mockClear();
    map.emit("styledata");
    expect(move).not.toHaveBeenCalled();
    clearPeopleFocusDim(map);
  });
});
