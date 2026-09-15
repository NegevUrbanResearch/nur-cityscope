import { describe, expect, test } from "vitest";

import {
  NLI_NARRATIVES,
  NLI_NARRATIVE_EXIT_SCENE,
  getNliNarrative,
  normalizeNarrativeState,
} from "../../frontend/src/shared/nli-narratives.js";

describe("NLI narrative registry", () => {
  test("contains the exact trusted Segev definition and frozen Nova sibling", () => {
    expect(NLI_NARRATIVES.segev).toEqual({
      id: "segev",
      label: "משפחת שגב",
      center: [34.48647925700004, 31.422958191000077],
      zoom: 18,
      basemap: "satellite_bw",
      focusSettlement: "בארי",
      focusSettlementOutlineId: 19,
      presentationUrl:
        "https://www.canva.com/design/DAHUaRcI6lI/Of1TuYlj0yaPV-r3UDQOKw/view?embed",
    });
    expect(NLI_NARRATIVES.nova).toEqual({
      id: "nova",
      label: "נובה",
      center: [34.46975, 31.39851],
      zoom: 15,
      gisZoom: 15,
      idleClockMinutes: 483,
      playStartMinutes: 483,
      basemap: "satellite_bw",
      focusInvestigationPolygonObjectId: 100,
      focusSettlement: "נובה",
      focusSettlementOutlineId: 43,
      hasEscapeOverlay: true,
    });
    expect(NLI_NARRATIVES).toEqual({
      segev: NLI_NARRATIVES.segev,
      nova: NLI_NARRATIVES.nova,
    });
    expect(NLI_NARRATIVES.nova).not.toHaveProperty("fitBounds");
    expect(NLI_NARRATIVES.nova).not.toHaveProperty("fitBoundsPadding");
    expect(NLI_NARRATIVES.nova).not.toHaveProperty("presentationUrl");
    expect(NLI_NARRATIVES.nova).not.toHaveProperty("escapeOverlay");
    expect(Object.isFrozen(NLI_NARRATIVES.nova)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.nova.center)).toBe(true);
  });

  test("contains the exact deterministic exit scene", () => {
    expect(NLI_NARRATIVE_EXIT_SCENE).toEqual({
      center: "configured OTEF bounds center",
      zoom: 10,
      basemap: "dark",
    });
  });

  test("freezes registry definitions and nested coordinates", () => {
    expect(Object.isFrozen(NLI_NARRATIVES)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.segev)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.segev.center)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVE_EXIT_SCENE)).toBe(true);
  });

  test("returns only trusted narrative definitions", () => {
    expect(getNliNarrative("segev")).toBe(NLI_NARRATIVES.segev);
    expect(getNliNarrative("unknown")).toBeNull();
    expect(getNliNarrative(null)).toBeNull();
  });

  test("normalizes valid active, replacement, and inactive state exactly", () => {
    expect(normalizeNarrativeState({ id: "segev", transition: "enter", revision: 4 })).toEqual({
      id: "segev",
      transition: "enter",
      revision: 4,
    });
    expect(normalizeNarrativeState({ id: "segev", transition: "replace", revision: 5 })).toEqual({
      id: "segev",
      transition: "replace",
      revision: 5,
    });
    expect(normalizeNarrativeState({
      id: null,
      transition: "exit",
      revision: 6,
      presentationOpen: true,
    })).toEqual({ id: null, transition: "exit", revision: 6 });
  });

  test("normalizes nova enter/replace the same way as segev", () => {
    expect(normalizeNarrativeState({ id: "nova", transition: "enter", revision: 4 })).toEqual({
      id: "nova",
      transition: "enter",
      revision: 4,
    });
    expect(getNliNarrative("nova")).toBe(NLI_NARRATIVES.nova);
  });

  test("normalizes revision zero, unsupported IDs, and inconsistent transitions inactive", () => {
    const inactive = { id: null, transition: "initial", revision: 0 };
    expect(normalizeNarrativeState(null)).toEqual(inactive);
    expect(normalizeNarrativeState({ id: "segev", transition: "enter", revision: 0 })).toEqual(inactive);
    expect(normalizeNarrativeState({ id: "unknown", transition: "enter", revision: 8 })).toEqual(inactive);
    expect(normalizeNarrativeState({ id: null, transition: "enter", revision: 8 })).toEqual(inactive);
    expect(normalizeNarrativeState({ id: "segev", transition: "exit", revision: 8 })).toEqual(inactive);
  });
});
