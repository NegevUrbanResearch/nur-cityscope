import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { NLI_PLAYABLE_IDS } from "../../frontend/src/shared/nli-investigation-beats.js";
import * as catalog from "../../frontend/src/remote/nli-staff-script.js";
import {
  NARRATIVES,
  HOME_SHOW_SHORTCUTS,
  FOCUS_LAYER_IDS,
  OPENING_LAYER_IDS,
  PEOPLE_NAMES_LAYER_IDS,
  SCRIPTS,
  SHOW,
  SHOW_STEP_IDS,
  TIMELINE_LAYER_IDS,
  WALL_LAYER_IDS,
} from "../../frontend/src/remote/nli-staff-script.js";
import { showStepIndex } from "../../frontend/src/remote/nli-staff-flow.js";
import { getNliNarrative } from "../../frontend/src/shared/nli-narratives.js";
import {
  createNliStaffPresentationButtonHandler,
  shouldAutoOpenNliPresentation,
} from "../../frontend/src/remote/nli-staff-presentation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_ROOT = path.resolve(__dirname, "../../public/processed/layers");
const KITS = new Set(["timeline", "archive", "branch", "search", "escape", "presentation"]);

const allSteps = () => SCRIPTS.flatMap((script) => script.steps.map((step) => ({ script, step })));
const allCues = () => [
  ...allSteps().map(({ step }) => step.cue),
].filter(Boolean);

test("names wall keeps people_names on the black model ground", () => {
  expect(PEOPLE_NAMES_LAYER_IDS).toEqual(["nli.people_names"]);
  expect(WALL_LAYER_IDS).toEqual(["nli.people_names"]);
  expect(WALL_LAYER_IDS).not.toEqual(OPENING_LAYER_IDS);
});

test("only a current explicit Hostages Close applies its special destination", async () => {
  const step = { presentation: { segmentId: "hostages", open: "manual", onClose: "next" } };
  let generation = 4;
  let releaseClose;
  const destinations = [];
  const handle = createNliStaffPresentationButtonHandler({
    getCurrentStep: () => step,
    getNavigationGeneration: () => generation,
    run: () => new Promise((resolve) => { releaseClose = () => resolve(true); }),
    nextFromExplicitClose: () => destinations.push("next"),
  });
  const closing = handle("close");
  await vi.waitFor(() => expect(releaseClose).toBeTypeOf("function"));
  generation += 1;
  releaseClose();
  await closing;
  expect(destinations).toEqual([]);
});

test("Shura auto-opens only after its current step cue succeeds", () => {
  const item = SCRIPTS.find((script) => script.id === "shura");
  const index = item.steps.findIndex((step) => step.presentation?.open === "auto");
  expect(shouldAutoOpenNliPresentation({
    item, index, currentScript: item, currentStep: item.steps[index], cueStatus: "ready",
  })).toBe(true);
  expect(shouldAutoOpenNliPresentation({
    item, index, currentScript: item, currentStep: item.steps[index], cueStatus: "failed",
  })).toBe(false);
  expect(shouldAutoOpenNliPresentation({
    item, index, currentScript: SCRIPTS.find((script) => script.id === "hostages"),
    currentStep: item.steps[index], cueStatus: "ready",
  })).toBe(false);
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

describe("NLI staff run of show", () => {
  test("follows the eight-stage sequence, starts at the opening minutes, and returns Home", () => {
    expect(SHOW.steps).toHaveLength(8);
    expect(SHOW.steps[0].id).toBe("opening-minutes");
    expect(SHOW.steps.map((step) => step.id)).not.toContain("opening");
    expect(SHOW.steps.map((step) => step.id)).not.toContain("timeline-complete");
    const branches = SHOW.steps.flatMap((step) => step.branch || []);
    expect(branches).toEqual(["segev", "nova", "sderot", "shura", "hostages"]);
    for (const id of branches) {
      expect(NARRATIVES.some((narrative) => narrative.id === id)).toBe(true);
    }
    expect(SHOW.steps.at(-1).id).toBe("back-to-start");
    expect(SHOW.steps.at(-1).cue).toBe(catalog.HOME_CUE);
    expect(SHOW.title).toEqual({ he: "רצף ההקרנה המלא", en: "Full projection sequence" });
  });

  test("Home enables the six geographic layers and leaves the investigation off", () => {
    expect(catalog.HOME_LAYER_IDS).toEqual([
      "projector_base.שמות_יישובים",
      "projector_base.Locations_Lines",
      "projector_base.ישובים",
      "nli.ציר_232",
      "projector_base.SEA",
      "gaza.Gaza_Roads",
    ]);
    expect(catalog.HOME_CUE).toEqual({
      narrative: null,
      layers: catalog.HOME_LAYER_IDS,
      clock: "idle",
      escape: {},
    });
    expect(catalog.HOME_LAYER_IDS).not.toEqual(FOCUS_LAYER_IDS);
    expect(catalog.HOME_LAYER_IDS).not.toEqual(TIMELINE_LAYER_IDS);
  });

  test("opening shows SEA and Gaza roads; the identity database hides Gaza roads", () => {
    expect(FOCUS_LAYER_IDS).toContain("nli.narrative_polygon");
    expect(OPENING_LAYER_IDS).toContain("nli.narrative_polygon");
    expect(OPENING_LAYER_IDS).toEqual(expect.arrayContaining(["projector_base.SEA", "gaza.Gaza_Roads"]));
    const identity = SHOW.steps.find((step) => step.id === SHOW_STEP_IDS.IDENTITY).cue.layers;
    expect(identity).toContain("nli.people");
    expect(identity).not.toContain("gaza.Gaza_Roads");
  });

  test("the opening minutes stop at 06:41 and the rest of the day starts at 06:42", () => {
    const minutes = SHOW.steps.find((step) => step.id === "opening-minutes");
    const rest = SHOW.steps.find((step) => step.id === "rest-of-day");
    expect(minutes.cue.clock).toEqual({ to: 401 });
    expect(minutes.note).toEqual({
      he: "ציר זמן 6:29–6:41, עד שעת ההתחלה של האירועים של משפחת שגב.",
      en: "Timeline 06:29–06:41, up to the start of the Segev family events.",
    });
    expect(rest.cue.clock).toEqual({ from: 402 });
    expect(rest.clock).toBe("06:42");
    expect(rest.note).toEqual({
      he: "ציר הזמן ממשיך מ־6:42 ועד סוף היום.",
      en: "The timeline runs from 06:42 to the end of the day.",
    });
  });

  test("the direct timeline shares the first two show steps and ends on the full story", () => {
    expect(SCRIPTS.slice(0, 2).map((script) => script.id)).toEqual(["show", "timeline"]);
    expect(NARRATIVES.map((script) => script.id)).not.toContain("timeline");
    expect(catalog.TIMELINE).toMatchObject({
      id: "timeline",
      narrative: null,
      title: { he: "ציר הזמן", en: "The timeline" },
    });
    expect(catalog.TIMELINE.steps).toHaveLength(3);
    expect(catalog.TIMELINE.steps[0]).toBe(SHOW.steps.find((step) => step.id === "opening-minutes"));
    expect(catalog.TIMELINE.steps[1]).toBe(SHOW.steps.find((step) => step.id === "rest-of-day"));
    expect(catalog.TIMELINE.steps[2]).toEqual({
      id: "timeline-complete",
      title: { he: "ציר הזמן המלא", en: "The full timeline" },
      cue: { narrative: null, layers: TIMELINE_LAYER_IDS, clock: "idle", escape: {} },
      kit: [],
    });
    expect(catalog.TIMELINE.steps[2].kit).not.toEqual(expect.arrayContaining(["timeline", "presentation"]));
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

  test("presentation segments use the approved six-segment GIS mapping", () => {
    const expected = [
      ["segev", "manual", "stay"],
      ["nova_mor", "manual", "stay"],
      ["nova_memorial", "auto", "stay"],
      ["sderot", "manual", "stay"],
      ["shura", "auto", "resume"],
      ["hostages", "manual", "next"],
    ];
    const presentationSteps = allSteps().filter(({ step }) => step.presentation);
    expect(presentationSteps.map(({ step }) => [
      step.presentation.segmentId,
      step.presentation.open,
      step.presentation.onClose,
    ])).toEqual(expected);
    expect(presentationSteps.every(({ step }) => step.kit.includes("presentation"))).toBe(true);
    expect(presentationSteps.map(({ step }) => step.presentation.segmentId)).toEqual(
      expect.arrayContaining(expected.map(([segmentId]) => segmentId)),
    );
  });

  test("Sderot and Shura use the approved slides and single-step automatic projection", () => {
    const sderot = NARRATIVES.find((narrative) => narrative.id === "sderot");
    const shura = NARRATIVES.find((narrative) => narrative.id === "shura");
    const shuraPresentation = shura.steps.find((step) => step.presentation);
    expect(sderot.steps).toHaveLength(1);
    expect(sderot.steps[0].presentation).toEqual({ segmentId: "sderot", open: "manual", onClose: "stay" });
    expect(sderot.steps[0].cue).toEqual({ layers: FOCUS_LAYER_IDS, clock: "idle" });
    expect(sderot.steps[0].kit).toEqual(["presentation"]);
    expect(shura.steps).toHaveLength(1);
    expect(shuraPresentation.cue).toEqual({ layers: TIMELINE_LAYER_IDS, clock: "idle" });
    expect(shuraPresentation.presentation).toEqual({ segmentId: "shura", open: "auto", onClose: "resume" });
  });

  test("every step declares known kits and bilingual titles without map cards", () => {
    for (const { step } of allSteps()) {
      expect(Array.isArray(step.kit)).toBe(true);
      for (const kit of step.kit) expect(KITS.has(kit)).toBe(true);
      expect(step.title.he).toBeTruthy();
      expect(step.title.en).toBeTruthy();
      expect(step).not.toHaveProperty("gis");
      expect(step).not.toHaveProperty("model");
      if (step.note) {
        expect(step.note.he).toBeTruthy();
        expect(step.note.en).toBeTruthy();
      }
      if (step.kit.includes("archive")) expect(step.personQuery).toBeTruthy();
      if (step.kit.includes("branch")) expect(step.branch?.length).toBeGreaterThan(0);
    }
    for (const step of SHOW.steps.filter((item) => item.branch)) {
      expect(step.kit).toEqual([]);
    }
  });

  test("Segev is one manual idle step and Hostages keeps four idle geographic steps", () => {
    const segev = NARRATIVES.find((narrative) => narrative.id === "segev");
    const hostages = NARRATIVES.find((narrative) => narrative.id === "hostages");
    expect(segev.steps).toEqual([
      {
        clock: "06:41",
        title: { he: "הבית בבארי", en: "The house in Be'eri" },
        cue: { layers: FOCUS_LAYER_IDS, clock: "idle" },
        kit: ["presentation"],
        presentation: { segmentId: "segev", open: "manual", onClose: "stay" },
      },
    ]);
    expect(hostages.title).toEqual({ he: "חיים פרי וחטופים", en: "Haim Peri and hostages" });
    expect(hostages.steps).toHaveLength(4);
    expect(hostages.steps.map((step) => step.cue.clock)).toEqual(["idle", "idle", "idle", "idle"]);
    expect(hostages.steps[1].presentation).toEqual({ segmentId: "hostages", open: "manual", onClose: "next" });
    for (const step of hostages.steps) {
      expect(step.note?.he ?? "").not.toContain("צריך לראות");
      expect(step.note?.en ?? "").not.toContain("Determine which presentation");
    }
  });

  test("Nova follows the ended escape and automatic memorial table", () => {
    const nova = NARRATIVES.find((narrative) => narrative.id === "nova");
    const novaLayers = [...FOCUS_LAYER_IDS, ...NLI_PLAYABLE_IDS];
    const [site, compounds, routes, mor, memorial] = nova.steps;
    expect(nova.steps).toHaveLength(5);
    expect(site.cue).toEqual({
      layers: [...FOCUS_LAYER_IDS, "land_use.שטחים_פתוחים"],
      clock: "idle",
      escape: {},
    });
    expect(site.kit).toEqual([]);
    expect(compounds.cue).toEqual({ layers: novaLayers, clock: {}, escape: {} });
    expect(compounds.kit).toEqual(["timeline"]);
    expect(routes.cue).toEqual({ layers: novaLayers, clock: "ended", escape: { individual: true } });
    expect(routes.kit).toEqual(["escape"]);
    expect(routes.escapeKinds).toEqual(["individual"]);
    expect(routes.note.en).toContain("Mor Levy");
    expect(mor.cue).toEqual({ layers: novaLayers, clock: "ended", escape: { mor: true } });
    expect(mor.kit).toEqual(["escape", "presentation"]);
    expect(mor.escapeKinds).toEqual(["mor"]);
    expect(mor.presentation).toEqual({ segmentId: "nova_mor", open: "manual", onClose: "stay" });
    expect(mor).not.toHaveProperty("personQuery");
    expect(mor.kit).not.toContain("archive");
    expect(mor.note.he).toContain("מור");
    expect(memorial.cue).toEqual({
      layers: [...FOCUS_LAYER_IDS, "nli.people"],
      clock: "ended",
      escape: { settled: true },
    });
    expect(memorial.kit).toEqual(["presentation"]);
    expect(memorial.presentation).toEqual({ segmentId: "nova_memorial", open: "auto", onClose: "stay" });
    expect(memorial).not.toHaveProperty("escapeKinds");
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
