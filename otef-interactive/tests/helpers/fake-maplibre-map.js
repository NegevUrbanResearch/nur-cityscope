/**
 * Small API-faithful MapLibre test double for scheduler and style lifecycle
 * tests. It deliberately exposes manual animation-frame driving so tests do
 * not depend on a browser event loop.
 */
export function createFakeMapLibreMap(options = {}) {
  return new FakeMapLibreMap(options);
}

export class FakeMapLibreMap {
  constructor(options = {}) {
    this._layers = (options.layers || []).map((layer) => ({ ...layer }));
    this._sources = new Map();
    this._listeners = new Map();
    this._paints = new Map();
    this._nextFrameId = 1;
    this._frames = new Map();
    this._calls = [];
    this._getStyleCalls = 0;
    for (const [id, properties] of Object.entries(options.paints || {})) {
      this._paints.set(id, { ...properties });
    }
    for (const [id, source] of Object.entries(options.sources || {})) {
      this.addSource(id, source);
    }
  }

  get calls() {
    return this._calls;
  }

  getStyle() {
    this._getStyleCalls += 1;
    return {
      version: 8,
      sources: Object.fromEntries(this._sources),
      layers: this._layers.map((layer) => ({ ...layer })),
    };
  }

  getLayer(id) {
    return this._layers.find((layer) => layer.id === id) || null;
  }

  getSource(id) {
    return this._sources.get(id) || null;
  }

  addSource(id, spec) {
    if (this._sources.has(id)) throw new Error(`Source already exists: ${id}`);
    const source = {
      ...spec,
      setData: (data) => {
        source.data = data;
        this._calls.push({ method: "setData", id, data });
      },
    };
    this._sources.set(id, source);
    this._calls.push({ method: "addSource", id, spec });
  }

  removeSource(id) {
    if (!this._sources.has(id)) throw new Error(`Source does not exist: ${id}`);
    if (this._layers.some((layer) => layer.source === id)) {
      throw new Error(`Source is in use: ${id}`);
    }
    this._sources.delete(id);
    this._calls.push({ method: "removeSource", id });
  }

  addLayer(layer, beforeId) {
    if (!layer || typeof layer.id !== "string") throw new Error("Layer id required");
    if (this.getLayer(layer.id)) throw new Error(`Layer already exists: ${layer.id}`);
    if (beforeId != null && !this.getLayer(beforeId)) {
      throw new Error(`Before layer does not exist: ${beforeId}`);
    }
    const copy = { ...layer };
    const index = beforeId == null ? this._layers.length : this._layers.findIndex((item) => item.id === beforeId);
    this._layers.splice(index < 0 ? this._layers.length : index, 0, copy);
    this._calls.push({ method: "addLayer", id: copy.id, beforeId });
  }

  removeLayer(id) {
    const index = this._layers.findIndex((layer) => layer.id === id);
    if (index < 0) throw new Error(`Layer does not exist: ${id}`);
    this._layers.splice(index, 1);
    this._calls.push({ method: "removeLayer", id });
  }

  moveLayer(id, beforeId) {
    const index = this._layers.findIndex((layer) => layer.id === id);
    if (index < 0) throw new Error(`Layer does not exist: ${id}`);
    const [layer] = this._layers.splice(index, 1);
    const target = beforeId == null ? this._layers.length : this._layers.findIndex((item) => item.id === beforeId);
    this._layers.splice(target < 0 ? this._layers.length : target, 0, layer);
    this._calls.push({ method: "moveLayer", id, beforeId });
  }

  getPaintProperty(id, key) {
    return this._paints.get(id)?.[key];
  }

  setPaintProperty(id, key, value) {
    if (!this.getLayer(id)) throw new Error(`Layer does not exist: ${id}`);
    const properties = this._paints.get(id) || {};
    properties[key] = value;
    this._paints.set(id, properties);
    this._calls.push({ method: "setPaintProperty", id, key, value });
  }

  on(type, listener) {
    const listeners = this._listeners.get(type) || new Set();
    listeners.add(listener);
    this._listeners.set(type, listeners);
    return this;
  }

  off(type, listener) {
    this._listeners.get(type)?.delete(listener);
    return this;
  }

  once(type, listener) {
    const wrapped = (...args) => {
      this.off(type, wrapped);
      listener(...args);
    };
    return this.on(type, wrapped);
  }

  emit(type, event = {}) {
    for (const listener of [...(this._listeners.get(type) || [])]) listener(event);
  }

  listenerCount(type) {
    return this._listeners.get(type)?.size || 0;
  }

  getStyleCallCount() {
    return this._getStyleCalls;
  }

  setStyle(style) {
    this._layers = (style?.layers || []).map((layer) => ({ ...layer }));
    this._sources = new Map(Object.entries(style?.sources || {}));
    this._calls.push({ method: "setStyle", style });
    this.emit("style.load", { type: "style.load" });
  }

  wipeStyle() {
    this._layers = [];
    this._sources.clear();
    this._calls.push({ method: "wipeStyle" });
  }

  remountStyle(style = {}) {
    this.setStyle(style);
  }

  requestAnimationFrame(callback) {
    const id = this._nextFrameId++;
    this._frames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id) {
    this._frames.delete(id);
  }

  driveAnimationFrame(timestamp = 0) {
    const next = this._frames.entries().next().value;
    if (!next) return false;
    const [id, callback] = next;
    this._frames.delete(id);
    callback(timestamp);
    return true;
  }

  pendingAnimationFrameCount() {
    return this._frames.size;
  }
}
