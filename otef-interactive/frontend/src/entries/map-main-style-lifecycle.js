/** Install the production basemap style-load reapplication ordering seam. */
export function installGisStyleReload({ map, refreshLayers, personVisual, getLayerGroups } = {}) {
  if (!map || typeof map.once !== "function" || typeof refreshLayers !== "function") return () => {};
  const onStyleLoad = async () => {
    await refreshLayers({
      groupsOverride: typeof getLayerGroups === "function" ? getLayerGroups() : undefined,
      syncFlow: false,
    });
    personVisual?.bringToFront?.();
  };
  map.once("style.load", onStyleLoad);
  return () => map.off?.("style.load", onStyleLoad);
}
