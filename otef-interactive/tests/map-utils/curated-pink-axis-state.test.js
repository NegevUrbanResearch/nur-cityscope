import { describe, expect, test } from "vitest";
import {
  PINK_LINE_PARKING_FULL_LAYER_ID,
  PINK_LINE_PARKING_LAYER_ID,
  PINK_LINE_ROUTE_FULL_LAYER_ID,
  PINK_LINE_ROUTE_LAYER_ID,
  applyMoreshetParkingCoherenceToLayerGroups,
  computePinkLineBaseLayerVisible,
  computePinkLineParkingOverlayVisible,
  ensureMoreshetAxisCompanionRows,
  ensurePinkLineParkingRowInMoreshetAxisGroup,
  ensurePinkLineRouteRowInMoreshetAxisGroup,
  finalizeMoreshetAxisPackForRemote,
  isPinkLineParkingLayerId,
  isPinkLineRouteLayerId,
} from "../../frontend/src/map-utils/curated-pink-axis-state.js";

describe("curated-pink-axis-state", () => {
  test("isPinkLineParkingLayerId", () => {
    expect(isPinkLineParkingLayerId(PINK_LINE_PARKING_LAYER_ID)).toBe(true);
    expect(isPinkLineParkingLayerId("42")).toBe(false);
  });

  test("isPinkLineRouteLayerId", () => {
    expect(isPinkLineRouteLayerId(PINK_LINE_ROUTE_LAYER_ID)).toBe(true);
    expect(isPinkLineRouteLayerId(PINK_LINE_PARKING_LAYER_ID)).toBe(false);
  });

  test("computePinkLineBaseLayerVisible ignores parking companion row", () => {
    const groups = [
      {
        id: "curated_moresht_axis",
        layers: [
          { id: "101", enabled: false },
          { id: PINK_LINE_PARKING_LAYER_ID, enabled: true },
        ],
      },
    ];
    expect(computePinkLineBaseLayerVisible(groups)).toBe(false);
    expect(computePinkLineParkingOverlayVisible(groups)).toBe(false);
  });

  test("computePinkLineBaseLayerVisible is true when only the pink-line toggle is on", () => {
    const groups = [
      {
        id: "curated_moresht_axis",
        layers: [
          { id: PINK_LINE_ROUTE_LAYER_ID, enabled: true },
          { id: "101", enabled: false },
          { id: PINK_LINE_PARKING_LAYER_ID, enabled: false },
        ],
      },
    ];
    expect(computePinkLineBaseLayerVisible(groups)).toBe(true);
    expect(computePinkLineParkingOverlayVisible(groups)).toBe(false);
  });

  test("computePinkLineBaseLayerVisible keeps workshop-layer coupling", () => {
    const groups = [
      {
        id: "curated_moresht_axis",
        layers: [
          { id: PINK_LINE_ROUTE_LAYER_ID, enabled: false },
          { id: "101", enabled: true },
          { id: PINK_LINE_PARKING_LAYER_ID, enabled: true },
        ],
      },
    ];
    expect(computePinkLineBaseLayerVisible(groups)).toBe(true);
  });

  test("parking overlay requires content on and user toggle on", () => {
    const on = [
      {
        id: "curated_moresht_axis",
        layers: [
          { id: "101", enabled: true },
          { id: PINK_LINE_PARKING_LAYER_ID, enabled: true },
        ],
      },
    ];
    expect(computePinkLineParkingOverlayVisible(on)).toBe(true);

    const parkingOff = [
      {
        id: "curated_moresht_axis",
        layers: [
          { id: "101", enabled: true },
          { id: PINK_LINE_PARKING_LAYER_ID, enabled: false },
        ],
      },
    ];
    expect(computePinkLineParkingOverlayVisible(parkingOff)).toBe(false);
  });

  test("applyMoreshetParkingCoherenceToLayerGroups turns parking off when no content on", () => {
    const next = applyMoreshetParkingCoherenceToLayerGroups([
      {
        id: "curated_moresht_axis",
        layers: [
          { id: "101", enabled: false },
          { id: PINK_LINE_PARKING_LAYER_ID, enabled: true },
        ],
      },
    ]);
    const p = next[0].layers.find((l) => l.id === PINK_LINE_PARKING_LAYER_ID);
    expect(p.enabled).toBe(false);
  });

  test("applyMoreshetParkingCoherenceToLayerGroups does not force pink line off", () => {
    const next = applyMoreshetParkingCoherenceToLayerGroups([
      {
        id: "curated_moresht_axis",
        layers: [
          { id: PINK_LINE_ROUTE_LAYER_ID, enabled: true },
          { id: "101", enabled: false },
          { id: PINK_LINE_PARKING_LAYER_ID, enabled: true },
        ],
      },
    ]);
    const pink = next[0].layers.find((l) => l.id === PINK_LINE_ROUTE_LAYER_ID);
    const parking = next[0].layers.find((l) => l.id === PINK_LINE_PARKING_LAYER_ID);
    expect(pink.enabled).toBe(true);
    expect(parking.enabled).toBe(false);
  });

  test("ensurePinkLineParkingRowInMoreshetAxisGroup appends parking when content exists", () => {
    const raw = [
      {
        id: "curated_moresht_axis",
        enabled: true,
        layers: [{ id: "101", displayName: "A", enabled: true }],
      },
    ];
    const next = ensurePinkLineParkingRowInMoreshetAxisGroup(raw);
    expect(next[0].layers.map((l) => l.id)).toContain(PINK_LINE_PARKING_LAYER_ID);
    expect(raw[0].layers).toHaveLength(1);
  });

  test("ensurePinkLineParkingRowInMoreshetAxisGroup is a no-op without Moreshet content", () => {
    const raw = [
      {
        id: "curated_moresht_axis",
        enabled: true,
        layers: [{ id: PINK_LINE_PARKING_LAYER_ID, enabled: true }],
      },
    ];
    const next = ensurePinkLineParkingRowInMoreshetAxisGroup(raw);
    expect(next).toBe(raw);
    expect(next[0].layers).toHaveLength(1);
  });

  test("ensurePinkLineRouteRowInMoreshetAxisGroup prepends pink line when content exists", () => {
    const raw = [
      {
        id: "curated_moresht_axis",
        enabled: true,
        layers: [{ id: "101", displayName: "A", enabled: true }],
      },
    ];
    const next = ensurePinkLineRouteRowInMoreshetAxisGroup(raw);
    expect(next[0].layers.map((l) => l.id)[0]).toBe(PINK_LINE_ROUTE_LAYER_ID);
    expect(next[0].layers.find((l) => l.id === PINK_LINE_ROUTE_LAYER_ID).enabled).toBe(
      false,
    );
    expect(raw[0].layers).toHaveLength(1);
  });

  test("ensureMoreshetAxisCompanionRows injects pink line first and parking last", () => {
    const next = ensureMoreshetAxisCompanionRows([
      {
        id: "curated_moresht_axis",
        enabled: true,
        layers: [{ id: "101", displayName: "A", enabled: true }],
      },
    ]);
    expect(next[0].layers.map((l) => l.id)).toEqual([
      PINK_LINE_ROUTE_LAYER_ID,
      "101",
      PINK_LINE_PARKING_LAYER_ID,
    ]);
  });

  test("finalizeMoreshetAxisPackForRemote drops empty pack and pins pink line first", () => {
    expect(
      finalizeMoreshetAxisPackForRemote([
        { id: "curated_moresht_axis", name: "Moreshet Axis", enabled: true, layers: [] },
      ]),
    ).toHaveLength(0);

    const withContent = finalizeMoreshetAxisPackForRemote([
      {
        id: "curated_moresht_axis",
        name: "Moreshet Axis",
        enabled: true,
        layers: [{ id: "7", displayName: "A", enabled: true }],
      },
    ]);
    expect(withContent).toHaveLength(1);
    const ids = withContent[0].layers.map((l) => l.id);
    expect(ids[0]).toBe(PINK_LINE_ROUTE_LAYER_ID);
    expect(ids[ids.length - 1]).toBe(PINK_LINE_PARKING_LAYER_ID);
    expect(withContent[0].layers.find((l) => l.id === PINK_LINE_ROUTE_LAYER_ID).enabled).toBe(
      false,
    );
    expect(PINK_LINE_PARKING_FULL_LAYER_ID).toBe(
      `curated_moresht_axis.${PINK_LINE_PARKING_LAYER_ID}`,
    );
    expect(PINK_LINE_ROUTE_FULL_LAYER_ID).toBe(
      `curated_moresht_axis.${PINK_LINE_ROUTE_LAYER_ID}`,
    );
  });
});
