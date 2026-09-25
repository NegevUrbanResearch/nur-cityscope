import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  NARRATIVES,
  HOME_SHOW_SHORTCUTS,
  OPENING_LAYER_IDS,
  PEOPLE_NAMES_LAYER_IDS,
  SCENES,
  SCRIPTS,
  SHOW,
  SHOW_STEP_IDS,
  WALL_LAYER_IDS,
} from "../../frontend/src/remote/nli-staff-script.js";
import { showStepIndex } from "../../frontend/src/remote/nli-staff-flow.js";
import { getNliNarrative } from "../../frontend/src/shared/nli-narratives.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_ROOT = path.resolve(__dirname, "../../public/processed/layers");
const KITS = new Set(["timeline", "archive", "branch", "search", "escape"]);

const allSteps = () => SCRIPTS.flatMap((script) => script.steps.map((step) => ({ script, step })));
const allCues = () => [
  ...allSteps().map(({ step }) => step.cue),
  ...SCENES.map((scene) => scene.cue),
].filter(Boolean);

test("names wall keeps people_names on the black model ground", () => {
  expect(PEOPLE_NAMES_LAYER_IDS).toEqual(["nli.people_names"]);
  expect(WALL_LAYER_IDS).toEqual(["nli.people_names"]);
  expect(WALL_LAYER_IDS).not.toEqual(OPENING_LAYER_IDS);
});

test("Home shortcuts target the canonical final show steps", () => {
  expect(new Set(SHOW.steps.map((step) => step.id)).size).toBe(SHOW.steps.length);
  expect(HOME_SHOW_SHORTCUTS.map((item) => item.id)).toEqual([
    SHOW_STEP_IDS.IDENTITY,
    SHOW_STEP_IDS.WALL,
  ]);
  expect(SHOW.steps[showStepIndex(SHOW_STEP_IDS.IDENTITY)].kit).toContain("search");
  expect(SHOW.steps[showStepIndex(SHOW_STEP_IDS.WALL)].kit).toContain("search");
});

test("Free control no longer duplicates identity and wall", () => {
  expect(SCENES.map((scene) => scene.id)).not.toEqual(
    expect.arrayContaining(["identity", "wall"]),
  );
});

describe("NLI staff run of show", () => {
  test("follows the nine-stage sequence and branches into existing narratives", () => {
    expect(SHOW.steps).toHaveLength(9);
    const branches = SHOW.steps.flatMap((step) => step.branch || []);
    expect(branches).toEqual(["segev", "nova", "sderot", "shura", "hostages"]);
    for (const id of branches) {
      expect(NARRATIVES.some((narrative) => narrative.id === id)).toBe(true);
    }
    expect(SHOW.steps[8].cue).toBe(SHOW.steps[0].cue);
  });

  test("opening shows SEA and Gaza roads; the identity database hides Gaza roads", () => {
    expect(OPENING_LAYER_IDS).toEqual(expect.arrayContaining(["projector_base.SEA", "gaza.Gaza_Roads"]));
    const identity = SHOW.steps[6].cue.layers;
    expect(identity).toContain("nli.people");
    expect(identity).not.toContain("gaza.Gaza_Roads");
  });

  test("the opening minutes stop at 06:41 and the rest of the day starts at 06:42", () => {
    expect(SHOW.steps[1].cue.clock).toEqual({ to: 401 });
    expect(SHOW.steps[3].cue.clock).toEqual({ from: 402 });
    expect(SHOW.steps[3].clock).toBe("06:42");
  });

  test("free control offers a looping timeline preset and the layers sheet", () => {
    expect(SCENES.find((scene) => scene.id === "loop").cue.clock).toEqual({ loop: true });
    expect(SCENES.some((scene) => scene.id === "layers")).toBe(true);
  });

  test("script narratives resolve to registered map scenes or the overview", () => {
    for (const script of SCRIPTS) {
      expect(script.narrative === null || !!getNliNarrative(script.narrative)).toBe(true);
      for (const step of script.steps) {
        const id = step.cue?.narrative;
        expect(id == null || !!getNliNarrative(id)).toBe(true);
      }
    }
  });

  test("hostages ends by leaving Nir Oz for the all-hostages overview", () => {
    const hostages = NARRATIVES.find((narrative) => narrative.id === "hostages");
    expect(hostages.steps[2].cue.narrative).toBeUndefined();
    expect(hostages.steps[3].cue.narrative).toBe("hostages_all");
  });

  test("every step declares known kits and bilingual copy", () => {
    for (const { step } of allSteps()) {
      for (const kit of step.kit) expect(KITS.has(kit)).toBe(true);
      for (const key of ["title", "gis", "model"]) {
        expect(step[key].he).toBeTruthy();
        expect(step[key].en).toBeTruthy();
      }
      if (step.kit.includes("archive")) expect(step.personQuery).toBeTruthy();
      if (step.kit.includes("branch")) expect(step.branch?.length).toBeGreaterThan(0);
    }
  });

  test.skipIf(!fs.existsSync(path.join(MANIFEST_ROOT, "nli/manifest.json")))(
    "every cue layer exists in the processed layer manifests",
    () => {
      const known = new Set();
      for (const pack of fs.readdirSync(MANIFEST_ROOT)) {
        const file = path.join(MANIFEST_ROOT, pack, "manifest.json");
        if (!fs.existsSync(file)) continue;
        const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
        for (const layer of manifest.layers || []) known.add(`${pack}.${layer.id}`);
      }
      const missing = allCues().flatMap((cue) => cue.layers || []).filter((id) => !known.has(id));
      expect([...new Set(missing)]).toEqual([]);
    },
  );
});
