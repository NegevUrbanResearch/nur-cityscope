const SETTLEMENT_LAYER_ID = "projector_base.שמות_יישובים";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function buildSettlementNameCatalog(featureCollection) {
  if (!featureCollection || featureCollection.type !== "FeatureCollection" || !Array.isArray(featureCollection.features)) {
    throw new TypeError("settlement catalog requires a FeatureCollection");
  }
  const seen = new Set();
  const entries = [];
  const referenceOffsets = new Map();
  for (const feature of featureCollection.features) {
    const citycode = feature?.properties?.citycode;
    if (typeof citycode !== "string" || !citycode) throw new TypeError("settlement catalog feature is missing a citycode");
    if (seen.has(citycode)) throw new TypeError(`duplicate settlement citycode ${citycode}`);
    seen.add(citycode);
    const coordinates = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.slice(0, 2).every(finite)) {
      throw new TypeError(`settlement catalog geometry is invalid for ${citycode}`);
    }
    const text = feature.properties.cityname ?? feature.properties.citylabel ?? "";
    entries.push({ citycode, text: String(text), lng: coordinates[0], lat: coordinates[1] });
    const stored=feature.properties.otef_map_text_offset_em;
    const offset=Array.isArray(stored) && stored.length===2 && stored.every(finite) ? stored : [Number(feature.properties.otef_label_offset_em_x)||0,Number(feature.properties.otef_label_offset_em_y)||0].map(value=>value/14);
    referenceOffsets.set(citycode,[...offset]);
  }
  return { entries, byCode: new Map(entries.map((entry) => [entry.citycode, entry])), referenceOffsets };
}

export async function loadSettlementNameCatalog({ registry, fetchImpl, signal }) {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const url = registry?.getLayerDataUrl?.(SETTLEMENT_LAYER_ID);
  if (!url) throw new TypeError("settlement catalog source is unavailable");
  const response = await fetchImpl(url, { signal });
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  if (!response?.ok) throw new Error("settlement catalog request failed");
  return buildSettlementNameCatalog(await response.json());
}
