import { expect, test } from "vitest";
import {
  OPENING_LAYER_IDS,
  PEOPLE_NAMES_LAYER_IDS,
  WALL_LAYER_IDS,
} from "../../frontend/src/remote/nli-staff-remote.js";

test("names wall keeps people_names on the black model ground", () => {
  expect(PEOPLE_NAMES_LAYER_IDS).toEqual(["nli.people_names"]);
  expect(WALL_LAYER_IDS).toContain("nli.people_names");
  expect(WALL_LAYER_IDS).toContain("projector_base.רקע_שחור");
  expect(WALL_LAYER_IDS).not.toEqual(OPENING_LAYER_IDS);
});
