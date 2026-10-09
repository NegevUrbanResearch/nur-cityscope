/** Source orientation shared by visible route rendering and contact indexing. */
export function orientInvestigationLineFeature(feature) {
  if (feature?.properties?.flow_direction !== "reverse") return feature;
  const geometry = feature.geometry;
  if (geometry?.type === "LineString")
    return {
      ...feature,
      geometry: {
        ...geometry,
        coordinates: [...geometry.coordinates].reverse(),
      },
    };
  if (geometry?.type === "MultiLineString")
    return {
      ...feature,
      geometry: {
        ...geometry,
        coordinates: [...geometry.coordinates]
          .reverse()
          .map((part) => [...part].reverse()),
      },
    };
  return feature;
}
