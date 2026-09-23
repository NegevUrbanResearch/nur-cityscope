import { describe, expect, test } from "vitest";
import {
  isolateLayersWhileVictimNamesShown,
  victimNamesAreShown,
} from "../../frontend/src/shared/nli-victim-name-layer-isolation.js";

const namesOn = () => [
  {
    id: "nli",
    layers: [
      { id: "people", enabled: true },
      { id: "people_names", enabled: true },
      { id: "lines", enabled: true },
      { id: "alarms", enabled: false },
    ],
  },
  {
    id: "projector_base",
    layers: [{ id: "שמות_יישובים", enabled: true }, { id: "model_base", enabled: true }],
  },
  {
    id: "curated_moresht_axis",
    layers: [{ id: "pink_line_route", enabled: true }],
  },
];

describe("victim name layer isolation", () => {
  test("leaves groups untouched when victim names are off", () => {
    const groups = namesOn();
    groups[0].layers[1].enabled = false;
    expect(victimNamesAreShown(groups)).toBe(false);
    expect(isolateLayersWhileVictimNamesShown(groups)).toBe(groups);
  });

  test("keeps only nli.people_names enabled while names are shown", () => {
    const groups = namesOn();
    const isolated = isolateLayersWhileVictimNamesShown(groups);
    expect(victimNamesAreShown(isolated)).toBe(true);
    expect(isolated[0].layers.find((layer) => layer.id === "people_names").enabled).toBe(true);
    expect(isolated[0].layers.find((layer) => layer.id === "people").enabled).toBe(false);
    expect(isolated[0].layers.find((layer) => layer.id === "lines").enabled).toBe(false);
    expect(isolated[0].layers.find((layer) => layer.id === "alarms")).toBe(groups[0].layers[3]);
    expect(isolated[1].layers.every((layer) => layer.enabled === false)).toBe(true);
    expect(isolated[2].layers[0].enabled).toBe(false);
  });

  test("does not mutate the stored group state", () => {
    const groups = namesOn();
    isolateLayersWhileVictimNamesShown(groups);
    expect(groups[0].layers.find((layer) => layer.id === "people").enabled).toBe(true);
    expect(groups[1].layers[0].enabled).toBe(true);
    expect(groups[2].layers[0].enabled).toBe(true);
  });
});
