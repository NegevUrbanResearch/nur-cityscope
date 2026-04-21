/**
 * Build a FeatureCollection for publish: current revisions from an API feature list.
 * History rows (is_current === false) and invalid entries are omitted.
 * Preserves collection-level CRS when present on the API response.
 * @param {unknown[]} features
 * @param {{ crs?: unknown } | null | undefined} [collectionMeta]
 * @param {{ display_color?: string; submission_name?: string } | null | undefined} [featureStamp]
 *   Optional batch fields merged onto every published feature when provided.
 */
export function buildPublishGeojsonFromApiFeatures(features, collectionMeta, featureStamp) {
  const list = Array.isArray(features) ? features : [];
  const stamp =
    featureStamp && typeof featureStamp === "object" ? featureStamp : null;
  const out = list.filter((f) => {
    if (!f || typeof f !== "object") return false;
    if ((f.properties || {}).is_current === false) return false;
    return true;
  });
  const fc = {
    type: "FeatureCollection",
    features: out.map((f) => {
      const base = f.properties ? { ...f.properties } : {};
      if (stamp) {
        const dc = stamp.display_color;
        if (dc != null && String(dc).trim() !== "") {
          base.display_color = String(dc).trim();
        }
        if (stamp.submission_name != null) {
          base.submission_name = String(stamp.submission_name).trim();
        }
      }
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: base,
      };
    }),
  };
  if (collectionMeta && typeof collectionMeta === "object" && collectionMeta.crs) {
    fc.crs = collectionMeta.crs;
  }
  return fc;
}
