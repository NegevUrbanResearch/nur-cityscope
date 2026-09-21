const ORDER = ["image", "map", "caption", "pattern", "legend"];

export function resolveProjectionSceneLayers(scene = {}) {
  return ORDER.flatMap((id) => scene[id] == null ? [] : [{ id, value: scene[id] }]);
}

function sourceDescriptor(id, value, adapters) {
  const result = adapters[id] ? adapters[id](value) : value;
  if (result == null) return null;
  if (!result || !result.source) throw new Error(`projection layer ${id} must be converted to an explicit texture descriptor`);
  return { ...result, id };
}

/**
 * Scene adapters return { source, matrix?, clip?, opacity? } descriptors.
 * Matrix maps normalized source coordinates to normalized output coordinates;
 * clip is [left, top, right, bottom] in output coordinates. Identity and full
 * clip are the defaults. The renderer consumes descriptors in scene order.
 */
export function createProjectionSurfaceCompositor({ renderer, sources = {}, adapters = {} } = {}) {
  if (!renderer?.draw) throw new Error("projection compositor requires a renderer");
  let scene = { ...sources };
  return {
    setScene(next) { scene = { ...scene, ...next }; },
    draw() {
      const layers = resolveProjectionSceneLayers(scene)
        .map(({ id, value }) => sourceDescriptor(id, value, adapters))
        .filter(Boolean);
      return renderer.draw({ layers });
    },
    dispose() { renderer.dispose?.(); },
  };
}
