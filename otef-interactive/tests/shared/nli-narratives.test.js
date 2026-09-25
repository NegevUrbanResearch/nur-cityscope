import { describe, expect, test } from "vitest";

import {
  NLI_NARRATIVES,
  NLI_NARRATIVE_EXIT_SCENE,
  getNliNarrative,
  normalizeNarrativeState,
} from "../../frontend/src/shared/nli-narratives.js";

describe("NLI narrative registry", () => {
  test("contains the Segev GIS definition and frozen Nova sibling", () => {
    expect(NLI_NARRATIVES.segev).toEqual({
      id: "segev",
      label: "בית משפחת שגב",
      center: [34.48647925700004, 31.422958191000077],
      zoom: 18,
      idleClockMinutes: 401,
      basemap: "satellite_bw",
      focusSettlement: "בארי",
      focusSettlementOutlineId: 19,
    });
    expect(NLI_NARRATIVES.nova).toEqual({
      id: "nova",
      label: "נובה",
      center: [34.46975, 31.39851],
      zoom: 15,
      beat4Zoom: 13.2,
      idleClockMinutes: 483,
      basemap: "satellite_bw",
      focusInvestigationPolygonObjectId: 100,
      focusSettlement: "נובה",
      focusSettlementOutlineId: 43,
      hasEscapeOverlay: true,
      keepFocusLabelWithAchieved: true,
    });
    expect(NLI_NARRATIVES.sderot).toEqual({
      id: "sderot",
      label: "תחנת המשטרה",
      center: [34.59744, 31.529518],
      zoom: 15,
      marker: [34.59205662207849, 31.52320675782405],
      basemap: "satellite_bw",
      focusSettlement: "שדרות",
      focusSettlementOutlineId: 32,
    });
    expect(NLI_NARRATIVES.hostages).toEqual({
      id: "hostages",
      label: "בית משפחת פרי",
      center: [34.40244, 31.312639],
      zoom: 15,
      marker: [34.40026099200003, 31.31130147400006],
      basemap: "satellite_bw",
      focusSettlement: "ניר עוז",
      focusSettlementOutlineId: 14,
    });
    expect(NLI_NARRATIVES).toEqual({
      segev: NLI_NARRATIVES.segev,
      nova: NLI_NARRATIVES.nova,
      sderot: NLI_NARRATIVES.sderot,
      hostages: NLI_NARRATIVES.hostages,
      hostages_all: NLI_NARRATIVES.hostages_all,
    });
    expect(NLI_NARRATIVES.hostages_all).toEqual({
      id: "hostages_all",
      center: [34.5, 31.4],
      zoom: 10,
      basemap: "satellite_bw",
    });
    expect(NLI_NARRATIVES.nova).not.toHaveProperty("presentationUrl");
    expect(NLI_NARRATIVES.nova).not.toHaveProperty("escapeOverlay");
    expect(NLI_NARRATIVES.sderot).not.toHaveProperty("presentationUrl");
    expect(NLI_NARRATIVES.hostages).not.toHaveProperty("presentationUrl");
    expect(NLI_NARRATIVES.sderot).not.toHaveProperty("hasEscapeOverlay");
    expect(NLI_NARRATIVES.hostages).not.toHaveProperty("hasEscapeOverlay");
    expect(Object.isFrozen(NLI_NARRATIVES.nova)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.nova.center)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.nova.argamaniCenter)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.sderot)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.hostages)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.sderot.center)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.sderot.marker)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.hostages.center)).toBe(true);
    expect(Object.isFrozen(NLI_NARRATIVES.hostages.marker)).toBe(true);
    expect(NLI_NARRATIVES.sderot.marker).not.toEqual(NLI_NARRATIVES.sderot.center);
    expect(NLI_NARRATIVES.hostages.marker).not.toEqual(NLI_NARRATIVES.hostages.center);
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

  test("normalizes sderot and hostages enter/replace", () => {
    expect(normalizeNarrativeState({ id: "sderot", transition: "enter", revision: 4 })).toEqual({
      id: "sderot",
      transition: "enter",
      revision: 4,
    });
    expect(normalizeNarrativeState({ id: "hostages", transition: "replace", revision: 5 })).toEqual({
      id: "hostages",
      transition: "replace",
      revision: 5,
    });
    expect(getNliNarrative("sderot")).toBe(NLI_NARRATIVES.sderot);
    expect(getNliNarrative("hostages")).toBe(NLI_NARRATIVES.hostages);
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
