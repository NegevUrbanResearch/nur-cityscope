import { createMapLibreGroupOpacity } from "./maplibre-group-opacity.js";
import { addPaintWriteObserver, peekLayerLifecycleRuntime } from "./layer-lifecycle-fade.js";
import { scaleOpacityExpression } from "./layer-opacity-expression.js";
import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { resolveMotionMode } from "./reduced-motion.js";

const groups = new WeakMap();
const COPY_PREFIX = "nli-people-focus-copy-";
const propertiesFor = (type) => type === "circle" ? ["circle-opacity", "circle-stroke-opacity"] : ["icon-opacity"];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nativeLayers = (map) => (map.getStyle?.()?.layers || []).filter((layer) =>
  layer.source === "nli.people" && !layer.id.startsWith(COPY_PREFIX) && ["circle", "symbol"].includes(layer.type));
const pidCase = (pid, selected, other) => ["case", ["==", ["to-string", ["get", "pid"]], pid], selected, other];
const isGroupMask = (paint) => Array.isArray(paint) && paint.length === 4 && paint[0] === "case"
  && paint[2] === 0 && paint[1]?.[0] === "=="
  && equal(paint[1]?.[1], ["to-string", ["get", "pid"]]);

function createGroup(map) {
  const entries = new Map();
  let pid = "";
  let syncing = false;
  const started = performance.now();
  const duration = resolveMotionMode() === "reduced" ? 0 : NLI_VISUAL_TOKENS.highlightOpacityTransitionMs;
  const compositor = createMapLibreGroupOpacity("nli-people-focus", () => {
    const progress = duration ? Math.min(1, (performance.now() - started) / duration) : 1;
    if (progress < 1) map.triggerRepaint();
    return 1 + (NLI_VISUAL_TOKENS.dimOpacity - 1) * progress;
  });

  function writeSelection(entry, property, factor = 1) {
    if (!map.getLayer(entry.copyId)) return;
    map.setPaintProperty(entry.copyId, `${property}-transition`, { duration: 0, delay: 0 });
    map.setPaintProperty(entry.copyId, property, scaleOpacityExpression(pidCase(pid, entry.base[property] ?? 1, 0), factor));
  }

  const unsubscribe = addPaintWriteObserver(map, ({ layerId, property, factor }) => {
    const entry = entries.get(layerId);
    if (!entry || !propertiesFor(entry.type).includes(property)) return;
    entry.factor = factor;
    writeSelection(entry, property, factor);
  });

  function apply(entry) {
    const runtime = peekLayerLifecycleRuntime(map);
    for (const property of propertiesFor(entry.type)) {
      const background = pidCase(pid, 0, entry.base[property] ?? 1);
      if (!runtime?.updateEffectivePaint(entry.source, entry.id, property, background)) {
        map.setPaintProperty(entry.id, `${property}-transition`, { duration: 0, delay: 0 });
        map.setPaintProperty(entry.id, property, background);
      }
      writeSelection(entry, property, entry.factor ?? 1);
    }
  }

  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const layers = nativeLayers(map);
      const previousEntries = new Map(entries);
      const ids = new Set(layers.map((layer) => layer.id));
      for (const [id, entry] of entries) {
        if (ids.has(id) && map.getLayer(id) === entry.instance) continue;
        if (map.getLayer(entry.copyId)) map.removeLayer(entry.copyId);
        entries.delete(id);
      }
      if (!layers.length) {
        for (const layer of [compositor.end, compositor.begin]) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        return;
      }
      // Keep other map layers outside the composite, even after a native layer reload/reorder.
      const styleLayers = map.getStyle().layers;
      const lastIndex = styleLayers.findLastIndex((layer) => ids.has(layer.id));
      const after = styleLayers.slice(lastIndex + 1).find((layer) =>
        !layer.id.startsWith(COPY_PREFIX) && ![compositor.begin.id, compositor.end.id].includes(layer.id))?.id;
      if (!map.getLayer(compositor.begin.id)) map.addLayer(compositor.begin, layers[0].id);
      if (!map.getLayer(compositor.end.id)) map.addLayer(compositor.end, after);
      for (const layer of layers) {
        let entry = entries.get(layer.id);
        if (!entry) {
          const runtime = peekLayerLifecycleRuntime(map);
          const base = {};
          const transitions = {};
          const previous = previousEntries.get(layer.id);
          for (const property of propertiesFor(layer.type)) {
            const owned = runtime?.hasPaintChannel(layer.source, property);
            const painted = map.getPaintProperty(layer.id, property);
            const restored = isGroupMask(painted);
            base[property] = owned ? runtime.readAuthoredOpacity(layer.source, property)
              : restored ? (previous ? previous.base[property] : painted[3]) : painted;
            transitions[property] = restored && previous ? previous.transitions[property]
              : map.getPaintProperty(layer.id, `${property}-transition`);
          }
          entry = { id: layer.id, type: layer.type, source: layer.source, instance: map.getLayer(layer.id), copyId: `${COPY_PREFIX}${layer.id}`, base, transitions };
          entries.set(layer.id, entry);
        }
        if (!map.getLayer(entry.copyId)) {
          const paint = { ...layer.paint };
          for (const property of propertiesFor(layer.type)) paint[property] = pidCase(pid, entry.base[property] ?? 1, 0);
          map.addLayer({ ...layer, id: entry.copyId, paint }, after);
          apply(entry);
        }
        // Filter and non-opacity styling remain owned by the native layer.
        const copy = map.getStyle().layers.find((item) => item.id === entry.copyId);
        if (!equal(copy.filter, layer.filter)) map.setFilter(entry.copyId, layer.filter ?? null);
        for (const [property, value] of Object.entries(layer.layout || {})) {
          if (!equal(copy.layout?.[property], value)) map.setLayoutProperty(entry.copyId, property, value);
        }
        for (const [property, value] of Object.entries(layer.paint || {})) {
          if (propertiesFor(layer.type).some((opacity) => property.startsWith(opacity))) continue;
          if (!equal(copy.paint?.[property], value)) map.setPaintProperty(entry.copyId, property, value);
        }
      }
      // Move the native run together, retaining native order, to avoid fading unrelated layers.
      const order = map.getLayersOrder?.() || map.getStyle().layers.map((layer) => layer.id);
      const expected = [compositor.begin.id, ...layers.map((layer) => layer.id), compositor.end.id, ...layers.map((layer) => entries.get(layer.id).copyId)];
      const start = order.indexOf(compositor.begin.id);
      if (!equal(order.slice(start, start + expected.length), expected)) {
        for (const id of expected) map.moveLayer(id, after);
      }
    } finally {
      syncing = false;
    }
  }

  const onRemove = () => dispose(false);
  map.on?.("styledata", sync);
  map.on?.("remove", onRemove);

  function dispose(restore = true) {
    map.off?.("styledata", sync);
    map.off?.("remove", onRemove);
    unsubscribe();
    if (restore) {
      const runtime = peekLayerLifecycleRuntime(map);
      for (const entry of entries.values()) {
        if (map.getLayer(entry.copyId)) map.removeLayer(entry.copyId);
        if (map.getLayer(entry.id) !== entry.instance) continue;
        for (const property of propertiesFor(entry.type)) {
          if (runtime?.updateEffectivePaint(entry.source, entry.id, property, entry.base[property] ?? 1)) continue;
          map.setPaintProperty(entry.id, property, entry.base[property] ?? null);
          map.setPaintProperty(entry.id, `${property}-transition`, entry.transitions[property] ?? null);
        }
      }
      for (const layer of [compositor.end, compositor.begin]) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    }
    entries.clear();
    groups.delete(map);
  }

  return {
    update(nextPid) { pid = nextPid; sync(); for (const entry of entries.values()) apply(entry); },
    forget(ids) {
      for (const id of ids) {
        const entry = entries.get(id);
        if (!entry) continue;
        if (map.getLayer(entry.copyId)) map.removeLayer(entry.copyId);
        entries.delete(id);
      }
      // Layer retirement does not clear the selected person. Keep listening for
      // replacement markers, including when selection precedes their first load.
      if (!entries.size) {
        for (const layer of [compositor.end, compositor.begin]) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      }
    },
    dispose,
  };
}

export function applyPeopleFocusGroup(map, pid) {
  if (!map?.addLayer || !map.removeLayer || !map.moveLayer) return false;
  if (!pid) { clearPeopleFocusGroup(map); return true; }
  let group = groups.get(map);
  if (!group) { group = createGroup(map); groups.set(map, group); }
  group.update(pid);
  return true;
}

export function clearPeopleFocusGroup(map) { groups.get(map)?.dispose(); }
export function forgetPeopleFocusGroupLayers(map, ids) { groups.get(map)?.forget(ids); }
