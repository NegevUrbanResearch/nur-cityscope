/** Decorative shelters have independent scene membership from road 232. */
export const SHELTER_SCENE_ID = "nli.shelters232";

export function shelterSceneIds(enabledIds, narrativeId = null) {
  return enabledIds.includes("nli.ציר_232") && (narrativeId === null || narrativeId === "nova")
    ? [SHELTER_SCENE_ID]
    : [];
}
