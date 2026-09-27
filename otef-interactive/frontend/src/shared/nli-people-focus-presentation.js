export const PEOPLE_FOCUS_DIM = 0.18;

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

export function applyPeopleFocusDim(map, selectedPid) {
  if (!map?.getPaintProperty || !map.setPaintProperty) return;
  const pid = selectedPid == null ? "" : String(selectedPid).trim();
  const state = paintState(map);
  for (const layer of peopleLayers(map)) {
    if (!map.getLayer?.(layer.id)) continue;
    for (const property of propertiesFor(layer)) {
      const key = `${layer.id}:${property}`;
      if (!state.has(key)) state.set(key, unwrapPeopleFocusCase(map.getPaintProperty(layer.id, property)));
      const base = state.get(key);
      map.setPaintProperty(layer.id, property, peopleFocusOpacityExpression(pid, base ?? 1));
    }
  }
}

export function clearPeopleFocusDim(map) {
  if (!map?.setPaintProperty) return;
  const state = originals.get(map);
  if (!state) return;
  for (const [key, value] of state) {
    const sep = key.lastIndexOf(":");
    const id = key.slice(0, sep);
    const property = key.slice(sep + 1);
    if (map.getLayer?.(id)) map.setPaintProperty(id, property, value);
  }
  originals.delete(map);
}
