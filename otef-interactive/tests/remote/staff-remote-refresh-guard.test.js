import { describe, expect, test } from "vitest";
import { HOME_LAYER_IDS } from "../../frontend/src/remote/nli-staff-script.js";
import { isCanonicalHome } from "../../frontend/src/remote/staff-remote-refresh-guard.js";

function groupsFor(enabledIds, { disabledGroups = [], disabledLayers = [] } = {}) {
  const groups = new Map();
  for (const fullId of enabledIds) {
    const dot = fullId.indexOf(".");
    const groupId = fullId.slice(0, dot);
    const layerId = fullId.slice(dot + 1);
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, enabled: !disabledGroups.includes(groupId), layers: [] });
    groups.get(groupId).layers.push({ id: layerId, enabled: !disabledLayers.includes(fullId) });
  }
  return [...groups.values()];
}

function homeSnapshot(overrides = {}) {
  return {
    narrativeState: { id: null, transition: "exit", revision: 4 },
    investigationClock: { phase: "idle", revision: 5, presentationPendingUntilMs: 0 },
    layerGroups: groupsFor(HOME_LAYER_IDS),
    personSelection: { personId: null, datasetVersion: null, revision: 0 },
    escapeOverlay: { individual: false, overlap: false, mor: false, settled: false },
    nowMs: 10_000,
    ...overrides,
  };
}

describe("staff remote refresh Home guard", () => {
  test("accepts only a confirmed canonical Home with exact enabled Home layers", () => {
    expect(isCanonicalHome(homeSnapshot())).toBe(true);
    expect(isCanonicalHome(homeSnapshot({ layerGroups: groupsFor([...HOME_LAYER_IDS, "nli.people"]) }))).toBe(false);
    expect(isCanonicalHome(homeSnapshot({ layerGroups: groupsFor(HOME_LAYER_IDS, { disabledGroups: ["projector_base"] }) }))).toBe(true);
    expect(isCanonicalHome(homeSnapshot({ layerGroups: groupsFor(HOME_LAYER_IDS, { disabledLayers: [HOME_LAYER_IDS[0]] }) }))).toBe(false);
  });

  test("uses individually enabled renderer layers when a group aggregate is false", () => {
    const partialHome = groupsFor(HOME_LAYER_IDS, { disabledGroups: ["projector_base"] });
    expect(isCanonicalHome(homeSnapshot({ layerGroups: partialHome }))).toBe(true);
    expect(isCanonicalHome({
      narrative_state: { id: null, transition: "exit", revision: 4 },
      investigation_clock: { phase: "idle", revision: 5, presentationPendingUntilMs: 0 },
      layerGroups: partialHome,
      person_selection: { personId: null, datasetVersion: null, revision: 2 },
      escape_overlay: { individual: false, overlap: false, mor: false, settled: false },
      nowMs: 10_000,
    })).toBe(true);
  });

  test("still rejects missing Home layers and enabled non-Home layers under a false group aggregate", () => {
    expect(isCanonicalHome(homeSnapshot({
      layerGroups: groupsFor(HOME_LAYER_IDS.slice(1), { disabledGroups: ["projector_base"] }),
    }))).toBe(false);
    expect(isCanonicalHome(homeSnapshot({
      layerGroups: groupsFor([...HOME_LAYER_IDS, "nli.people"], { disabledGroups: ["projector_base"] }),
    }))).toBe(false);
  });

  test("accepts the raw GET /otef/ API field names without inventing defaults", () => {
    expect(isCanonicalHome({
      narrative_state: { id: null, transition: "exit", revision: 4 },
      investigation_clock: { phase: "idle", revision: 5, presentationPendingUntilMs: 0 },
      layerGroups: groupsFor(HOME_LAYER_IDS),
      person_selection: { personId: null, datasetVersion: null, revision: 2 },
      escape_overlay: { individual: false, overlap: false, mor: false, settled: false },
      nowMs: 10_000,
    })).toBe(true);
    expect(isCanonicalHome({
      investigation_clock: { phase: "idle" },
      layerGroups: groupsFor(HOME_LAYER_IDS),
      person_selection: { personId: null },
      escape_overlay: { individual: false, overlap: false, mor: false, settled: false },
    })).toBe(false);
    expect(isCanonicalHome({
      narrative_state: { id: null, transition: "exit", revision: 4 },
      investigation_clock: { phase: "idle", revision: 4 },
      layerGroups: groupsFor(HOME_LAYER_IDS),
      person_selection: { personId: null },
      escape_overlay: { individual: false, overlap: false, mor: false, settled: false },
    })).toBe(false);
    expect(isCanonicalHome({
      narrative_state: { id: null, transition: "exit", revision: 4 },
      investigation_clock: { phase: "idle" },
      layerGroups: groupsFor(HOME_LAYER_IDS),
      person_selection: { personId: null, datasetVersion: null, revision: 4 },
      escape_overlay: { individual: false, overlap: false, mor: false, settled: false },
    })).toBe(false);
  });

  test.each([
    ["missing snapshot", undefined],
    ["missing narrative revision", homeSnapshot({ narrativeState: { id: null, transition: "exit" } })],
    ["steady null narrative", homeSnapshot({ narrativeState: { id: null, transition: "steady", revision: 4 } })],
    ["active narrative", homeSnapshot({ narrativeState: { id: "nova", transition: "exit", revision: 4 }, localScreen: "home" })],
    ["timeline layers", homeSnapshot({ layerGroups: groupsFor([...HOME_LAYER_IDS, "nli.lines"]) })],
    ["wall layers", homeSnapshot({ layerGroups: groupsFor(["nli.people_names"]) })],
    ["credits layers", homeSnapshot({ layerGroups: groupsFor(["nli.people_names"]) })],
    ["missing Home layer", homeSnapshot({ layerGroups: groupsFor(HOME_LAYER_IDS.slice(1)) })],
    ["selected person", homeSnapshot({ personSelection: { personId: "ada" } })],
    ["escape overlay", homeSnapshot({ escapeOverlay: { individual: true } })],
    ["active presentation hold", homeSnapshot({ investigationClock: { phase: "idle", presentationPendingUntilMs: 10_001 } })],
    ["non-idle clock", homeSnapshot({ investigationClock: { phase: "playing" } })],
    ["malformed idle clock", homeSnapshot({ investigationClock: { phase: "idle" } })],
  ])("rejects %s", (_name, snapshot) => {
    expect(isCanonicalHome(snapshot)).toBe(false);
  });

  test("allows an old local player view when the canonical state is Home", () => {
    expect(isCanonicalHome(homeSnapshot({ localScreen: "player" }))).toBe(true);
  });
});
