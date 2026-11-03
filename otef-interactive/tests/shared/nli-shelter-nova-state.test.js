import { it, expect } from "vitest";
import {
  deriveShelterVictimImpactIds,
  publishNovaShelterDestinations,
  subscribeNovaShelterDestinations,
  getNovaShelterDestinations,
} from "../../frontend/src/shared/nli-shelter-nova-state.js";

const shelters = [
  { id: "west", properties: { personPids: ["abducted"], novaRouteObjectIds: ["19"] } },
  { id: "east", properties: { personPids: ["killed"], novaRouteObjectIds: ["20"] } },
  { id: "nearby-only", properties: { nearbyPersonPids: ["someone"] } },
];
const input = { shelters, frame: { narrative: { phase: "ended" }, completedBeats: [780] },
  narrativeId: "nova", peopleVisible: false, timelineVisible: true,
  expectedRouteSHA256: "accepted", destinations: { routeSHA256: "accepted", completedRouteIds: ["19"] } };

it("reveals only the mapped destination in fleeing, including abductions, despite the ended clock", () => {
  expect([...deriveShelterVictimImpactIds(input)]).toEqual(["west"]);
  expect([...deriveShelterVictimImpactIds({ ...input, destinations: { routeSHA256: "accepted", completedRouteIds: ["unmapped"] } })]).toEqual([]);
  expect([...deriveShelterVictimImpactIds({ ...input, destinations: { routeSHA256: "stale", completedRouteIds: ["19"] } })]).toEqual([]);
});

it("shows direct victim shelters in the final Nova victims and Identity scenes without status filtering", () => {
  for (const narrativeId of ["nova", null])
    expect([...deriveShelterVictimImpactIds({ ...input, narrativeId, peopleVisible: true, timelineVisible: false })]).toEqual(["west", "east"]);
  expect([...deriveShelterVictimImpactIds({ ...input, narrativeId: "segev", peopleVisible: true })]).toEqual([]);
});
it("adding people to an active timeline or fleeing view does not reveal future shelter destinations", () => {
  expect([...deriveShelterVictimImpactIds({ ...input, peopleVisible: true })]).toEqual(["west"]);
  expect(deriveShelterVictimImpactIds({ ...input, narrativeId: null, peopleVisible: true,
    frame: { narrative: { phase: "paused" }, activeBeat: 630, completedBeats: [] } }).size).toBe(0);
});

it("uses the 12:00 beat in the general timeline and recomputes on backwards seek, stop and idle overview", () => {
  const general = { ...input, narrativeId: null, destinations: null };
  for (const phase of ["playing", "paused"])
    for (const activeBeat of [630, 719, 720, 750, 780])
      expect(deriveShelterVictimImpactIds({ ...general, frame: { narrative: { phase }, activeBeat, completedBeats: [] } }).size).toBe(activeBeat >= 720 ? 2 : 0);
  expect(deriveShelterVictimImpactIds({ ...general, frame: { narrative: { phase: "ended" }, completedBeats: [630] } }).size).toBe(0);
  expect(deriveShelterVictimImpactIds({ ...general, frame: { narrative: { phase: "idle" } } }).size).toBe(2);
  expect(deriveShelterVictimImpactIds({ ...general, timelineVisible: false }).size).toBe(0);
  expect(deriveShelterVictimImpactIds({ ...input, destinations: null, frame: { narrative: { phase: "idle" } } }).size).toBe(0);
});

it("publishes semantic destination changes once and clears them on replay/exit", () => {
  const map = {}, seen = [];
  const unsubscribe = subscribeNovaShelterDestinations(map, () => seen.push(getNovaShelterDestinations(map)));
  publishNovaShelterDestinations(map, { routeSHA256: "accepted", completedRouteIds: ["20", "19", "19"] });
  publishNovaShelterDestinations(map, { routeSHA256: "accepted", completedRouteIds: ["19", "20"] });
  expect(seen).toHaveLength(1);
  publishNovaShelterDestinations(map, null);
  expect(getNovaShelterDestinations(map)).toBeNull();
  expect(seen).toHaveLength(2);
  unsubscribe();
});
