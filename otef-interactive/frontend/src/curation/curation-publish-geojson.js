/**
 * Build a FeatureCollection for publish: current revisions from an API feature list.
 * History rows (is_current === false) and invalid entries are omitted.
 * Preserves collection-level CRS when present on the API response.
 * @param {unknown[]} features
 * @param {{ crs?: unknown } | null | undefined} [collectionMeta]
 */
export function buildPublishGeojsonFromApiFeatures(features, collectionMeta) {
  const list = Array.isArray(features) ? features : [];
  const out = list.filter((f) => {
    if (!f || typeof f !== "object") return false;
    if ((f.properties || {}).is_current === false) return false;
    return true;
  });
  const fc = {
    type: "FeatureCollection",
    features: out.map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: f.properties ? { ...f.properties } : {},
    })),
  };
  if (collectionMeta && typeof collectionMeta === "object" && collectionMeta.crs) {
    fc.crs = collectionMeta.crs;
  }
  return fc;
}
