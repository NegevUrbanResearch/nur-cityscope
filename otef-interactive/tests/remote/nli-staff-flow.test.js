import { describe, expect, test } from "vitest";
import { nextAction, prevAction, showStepIndex, slideIndexes } from "../../frontend/src/remote/nli-staff-flow.js";
import { COPY, HOME_SHOW_SHORTCUTS, NARRATIVES, SHOW } from "../../frontend/src/remote/nli-staff-script.js";

const showIndex = (title) => SHOW.steps.findIndex((step) => step.title.en === title);
const lastOf = (id) => NARRATIVES.find((item) => item.id === id).steps.length - 1;
const junction = (ids) => SHOW.steps.findIndex((step) => step.branch?.join() === ids.join());

describe("NLI staff show flow", () => {
  test("home search shortcuts point to canonical SHOW step IDs", () => {
    expect(HOME_SHOW_SHORTCUTS.every((item) => SHOW.steps[showStepIndex(item.id)]?.id === item.id)).toBe(true);
  });

  test("search status copy reports reset failures without a currently-shown label", () => {
    expect(COPY.he.searchClearFailed).toBeTruthy();
    expect(COPY.en.searchClearFailed).toBeTruthy();
    expect(COPY.he).not.toHaveProperty("nowShowing");
    expect(COPY.en).not.toHaveProperty("nowShowing");
  });

  test("branch steps are junctions, not slides", () => {
    const slides = slideIndexes(SHOW).map((index) => SHOW.steps[index]);
    expect(slides.some((step) => step.branch)).toBe(false);
    expect(slides).toHaveLength(SHOW.steps.length - 3);
  });

  test("the opening minutes offer the Segev story instead of skipping it", () => {
    expect(nextAction({ scriptId: "show", step: showIndex("The opening minutes"), returnTo: null })).toEqual({
      kind: "choose",
      scriptId: "show",
      junction: junction(["segev"]),
      ids: ["segev"],
    });
  });

  test("finishing Segev resumes the show after its junction", () => {
    const returnTo = { id: "show", step: junction(["segev"]) };
    expect(nextAction({ scriptId: "segev", step: lastOf("segev"), returnTo })).toEqual({
      kind: "resume",
      scriptId: "show",
      step: showIndex("The rest of the day"),
    });
  });

  test("the last Nova slide offers the three free-choice narratives", () => {
    const returnTo = { id: "show", step: junction(["nova"]) };
    expect(nextAction({ scriptId: "nova", step: lastOf("nova"), returnTo })).toMatchObject({
      kind: "choose",
      ids: ["sderot", "shura", "hostages"],
    });
  });

  test("a free-choice narrative resumes at the identity database", () => {
    const returnTo = { id: "show", step: junction(["sderot", "shura", "hostages"]) };
    expect(nextAction({ scriptId: "sderot", step: lastOf("sderot"), returnTo })).toMatchObject({
      kind: "resume",
      step: showIndex("Identity database"),
    });
  });

  test("a narrative opened from home finishes at its last step", () => {
    expect(nextAction({ scriptId: "segev", step: lastOf("segev"), returnTo: null })).toEqual({ kind: "finish" });
    expect(nextAction({ scriptId: "segev", step: 0, returnTo: null })).toEqual({ kind: "step", scriptId: "segev", step: 1 });
  });

  test("closing the Hostages presentation advances through Nir Oz people to all hostages", () => {
    const hostages = NARRATIVES.find((item) => item.id === "hostages");
    const presentationIndex = hostages.steps.findIndex((step) => step.presentation);
    const presentation = hostages.steps[presentationIndex];
    expect(presentation.presentation).toEqual({ segmentId: "hostages", open: "manual", onClose: "next" });
    expect(hostages.steps[presentationIndex + 1].title.en).toBe("Nir Oz victims and hostages");
    expect(hostages.steps[presentationIndex + 1].cue.layers).toContain("nli.people");
    expect(hostages.steps[presentationIndex + 2].title.en).toBe("All hostages");
    expect(hostages.steps[presentationIndex + 2].cue.narrative).toBe("hostages_all");
  });

  test("previous skips junctions and leaves a narrative for the slide before it", () => {
    expect(prevAction({ scriptId: "show", step: showIndex("The rest of the day"), returnTo: null })).toEqual({
      scriptId: "show",
      step: showIndex("The opening minutes"),
      returnTo: null,
    });
    const returnTo = { id: "show", step: junction(["segev"]) };
    expect(prevAction({ scriptId: "segev", step: 0, returnTo })).toEqual({
      scriptId: "show",
      step: showIndex("The opening minutes"),
      returnTo: null,
    });
    expect(prevAction({ scriptId: "show", step: 0, returnTo: null })).toBeNull();
  });
});
