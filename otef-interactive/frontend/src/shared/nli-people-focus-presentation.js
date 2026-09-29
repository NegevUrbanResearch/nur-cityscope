import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { getLayerLifecycleRuntime } from "./layer-lifecycle-fade.js";

export const PEOPLE_FOCUS_DIM = NLI_VISUAL_TOKENS.dimOpacity;
const PEOPLE_FOCUS_TRANSITION = Object.freeze({
  duration: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs,
  delay: 0,
});

const originals = new WeakMap();

export function peopleFocusOpacityExpression(selectedPid, base) {
  const resolved = base == null ? 1 : base;
  const pid = selectedPid == null ? "" : String(selectedPid).trim();
  if (!pid) return resolved;
  return [
    "case",
    ["==", ["to-string", ["get", "pid"]], pid],
    resolved,
    ["*", resolved, PEOPLE_FOCUS_DIM],
  ];
}

function paintState(map) {
  let state = originals.get(map);
  if (!state) {
    state = new Map();
    originals.set(map, state);
  }
  return state;
}

function peopleLayers(map) {
  const layers = map?.getStyle?.()?.layers;
  return Array.isArray(layers) ? layers.filter((layer) => layer?.source === "nli.people") : [];
}

function propertiesFor(layer) {
  if (layer.type === "circle") return ["circle-opacity", "circle-stroke-opacity"];
  if (layer.type === "symbol") return ["icon-opacity"];
  return [];
}

function isPidFocusCase(paint) {
  if (!Array.isArray(paint) || paint[0] !== "case") return false;
  const cond = paint[1];
  if (!Array.isArray(cond) || cond[0] !== "==") return false;
  const left = cond[1];
  if (!Array.isArray(left) || left[0] !== "to-string") return false;
  const getPid = left[1];
  return Array.isArray(getPid) && getPid[0] === "get" && getPid[1] === "pid";
}

function unwrapPeopleFocusCase(paint) {
  let current = paint;
  while (isPidFocusCase(current)) {
    current = current[2];
  }
  return current;
}

function snapshotValue(saved) {
  if (saved && typeof saved === "object" && Object.prototype.hasOwnProperty.call(saved, "value")) {
    return saved.value;
  }
  return saved;
}

function runtimeOpacity(map, source, property) {
  if (!map || source == null || source === "") return null;
  const runtime = getLayerLifecycleRuntime(map);
  if (!runtime?.hasPaintChannel?.(source, property)) return null;
  const authored = runtime.readAuthoredOpacity(source, property);
  return { runtime, base: authored === undefined ? 1 : authored };
}

export function forgetPeopleFocusLayers(map, layerIds) {
  const state = originals.get(map);
  if (!state || !Array.isArray(layerIds)) return;
  for (const layerId of layerIds) {
    const prefix = `${layerId}:`;
    for (const key of [...state.keys()]) {
      if (key.startsWith(prefix)) state.delete(key);
    }
  }
  if (state.size === 0) originals.delete(map);
}

export function applyPeopleFocusDim(map, selectedPid) {
  if (!map?.getPaintProperty || !map.setPaintProperty) return;
  const pid = selectedPid == null ? "" : String(selectedPid).trim();
  const state = paintState(map);
  for (const layer of peopleLayers(map)) {
    const instance = map.getLayer?.(layer.id);
    if (!instance) continue;
    for (const property of propertiesFor(layer)) {
      const owned = runtimeOpacity(map, layer.source, property);
      if (owned) {
        state.delete(`${layer.id}:${property}`);
        owned.runtime.updateEffectiveOpacity(
          layer.source,
          property,
          peopleFocusOpacityExpression(pid, owned.base),
        );
        continue;
      }
      const key = `${layer.id}:${property}`;
      const saved = state.get(key);
      if (!saved || saved.layer !== instance) {
        state.set(key, {
          layer: instance,
          value: unwrapPeopleFocusCase(map.getPaintProperty(layer.id, property)),
        });
      }
      const base = snapshotValue(state.get(key));
      map.setPaintProperty(layer.id, `${property}-transition`, PEOPLE_FOCUS_TRANSITION);
      map.setPaintProperty(layer.id, property, peopleFocusOpacityExpression(pid, base ?? 1));
    }
  }
}

export function clearPeopleFocusDim(map) {
  if (!map?.setPaintProperty) return;
  for (const layer of peopleLayers(map)) {
    if (!map.getLayer?.(layer.id)) continue;
    for (const property of propertiesFor(layer)) {
      const owned = runtimeOpacity(map, layer.source, property);
      if (!owned) continue;
      owned.runtime.updateEffectiveOpacity(layer.source, property, owned.base);
    }
  }
  const state = originals.get(map);
  if (!state) return;
  for (const [key, saved] of state) {
    const sep = key.lastIndexOf(":");
    const id = key.slice(0, sep);
    const property = key.slice(sep + 1);
    if (map.getLayer?.(id)) {
      const instance = map.getLayer(id);
      if (!saved || saved.layer !== instance) {
        state.delete(key);
        continue;
      }
      if (runtimeOpacity(map, instance?.source, property)) continue;
      map.setPaintProperty(id, `${property}-transition`, PEOPLE_FOCUS_TRANSITION);
      map.setPaintProperty(id, property, snapshotValue(saved));
    }
  }
  originals.delete(map);
}
