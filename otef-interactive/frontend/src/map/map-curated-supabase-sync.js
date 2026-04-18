/**
 * After a curated Supabase pull, refresh API layer groups and sync the GIS map:
 * reload packs already loaded, then load any newly enabled curated ids.
 *
 * @param {{ reloadCuratedOnMap: () => void, loadLayerFromRegistry: (fullLayerId: string) => Promise<void> }} options
 */
export async function syncCuratedMapLayersAfterSupabasePull(options) {
  const { reloadCuratedOnMap, loadLayerFromRegistry } = options;
  if (
    typeof OTEFDataContext !== "undefined" &&
    typeof OTEFDataContext.refreshLayerGroupsFromApi === "function"
  ) {
    await OTEFDataContext.refreshLayerGroupsFromApi();
  }
  reloadCuratedOnMap();
  if (
    typeof LayerStateHelper !== "undefined" &&
    typeof LayerStateHelper.getEffectiveLayerGroups === "function"
  ) {
    const groups = LayerStateHelper.getEffectiveLayerGroups();
    for (const group of groups || []) {
      if (!group || typeof group.id !== "string" || !group.id.startsWith("curated")) {
        continue;
      }
      for (const layer of group.layers || []) {
        if (!layer.enabled) continue;
        if (
          typeof shouldShowLayerOnGisMap === "function" &&
          !shouldShowLayerOnGisMap(group.id, layer.id)
        ) {
          continue;
        }
        void loadLayerFromRegistry(`${group.id}.${layer.id}`);
      }
    }
  }
}
