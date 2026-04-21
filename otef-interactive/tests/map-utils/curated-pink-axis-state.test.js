import { describe, expect, test } from "vitest";
import {
  PINK_LINE_PARKING_FULL_LAYER_ID,
  PINK_LINE_PARKING_LAYER_ID,
  applyMoreshetParkingCoherenceToLayerGroups,
  computePinkLineBaseLayerVisible,
  computePinkLineParkingOverlayVisible,
  ensurePinkLineParkingRowInMoreshetAxisGroup,
  finalizeMoreshetAxisPackForRemote,
  isPinkLineParkingLayerId,
} from "../../frontend/src/map-utils/curated-pink-axis-state.js";

describe("curated-pink-axis-state", () => {
  test("isPinkLineParkingLayerId", () => {
    expect(isPinkLineParkingLayerId(PINK_LINE_PARKING_LAYER_ID)).toBe(true);
    expect(isPinkLineParkingLayerId("42")).toBe(false);
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

  test("finalizeMoreshetAxisPackForRemote drops empty pack and appends parking row", () => {
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
    expect(ids[ids.length - 1]).toBe(PINK_LINE_PARKING_LAYER_ID);
    expect(PINK_LINE_PARKING_FULL_LAYER_ID).toBe(
      `curated_moresht_axis.${PINK_LINE_PARKING_LAYER_ID}`,
    );
  });
});
