import { expect, it } from "vitest";
import { shelterSceneIds, SHELTER_SCENE_ID } from "../../frontend/src/shared/nli-shelter-scene.js";
import { HOME_LAYER_IDS, IDENTITY_LAYER_IDS, TIMELINE_LAYER_IDS, SCRIPTS } from "../../frontend/src/remote/nli-staff-script.js";

it.each([
  ["home", HOME_LAYER_IDS, null, true],
  ["timeline", TIMELINE_LAYER_IDS, null, true],
  ["identity", IDENTITY_LAYER_IDS, null, true],
  ...SCRIPTS.filter(script => ["nova", "shura", "segev", "sderot", "hostages"].includes(script.id))
    .map(script => [script.id, script.steps[0].cue.layers, script.narrative, ["nova", "shura"].includes(script.id)]),
  ["all hostages", HOME_LAYER_IDS, "hostages_all", false],
  ["names wall", ["nli.people_names"], null, false],
])("%s cue has the requested shelter scene membership", (_name, ids, narrative, visible) => {
  expect(shelterSceneIds(ids, narrative)).toEqual(visible ? [SHELTER_SCENE_ID] : []);
});
