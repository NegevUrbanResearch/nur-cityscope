import { afterEach, describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import {
  createGisCuratedRefresh,
  createProjectionCuratedRefresh,
} from "../../frontend/src/map/maplibre-curated-layer-loader.js";
import { NAME_FIELD_MOTION } from "../../frontend/src/shared/nli-name-field-animation.js";
import {
  createNameFieldExitGate,
  createNameWallSceneExit,
} from "../../frontend/src/shared/nli-name-wall-scene-exit.js";

const namesOn = () => [{ id: "nli", layers: [{ id: "people_names", enabled: true }] }];
const namesOff = () => [{ id: "nli", layers: [{ id: "people_names", enabled: false }] }];
const home = () => [
  { id: "nli", layers: [{ id: "people_names", enabled: false }, { id: "ציר_232", enabled: true }] },
  { id: "projector_base", layers: [{ id: "SEA", enabled: true }] },
];

afterEach(() => {
  vi.useRealTimers();
});

describe("createNameWallSceneExit", () => {
  test("strips people_names, waits the name fade, and joins an overlapping exit", async () => {
    vi.useFakeTimers();
    const groups = namesOn();
    const commits = [];
    const exit = createNameWallSceneExit({
      getLayerGroups: () => groups,
      commitLayers: async (ids) => {
        commits.push([...ids]);
        groups[0].layers[0].enabled = false;
      },
    });

    const first = exit.fadeOutIfShown();
    await Promise.resolve();
    expect(commits).toEqual([[]]);

    let firstDone = false;
    first.then(() => { firstDone = true; });
    await vi.advanceTimersByTimeAsync(NAME_FIELD_MOTION.hideMs - 1);
    expect(firstDone).toBe(false);

    const second = exit.fadeOutIfShown();
    let secondDone = false;
    second.then(() => { secondDone = true; });
    expect(commits).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(firstDone).toBe(true);
    expect(secondDone).toBe(true);
  });

  test("does not commit or wait when the name wall is already off", async () => {
    const commitLayers = vi.fn(async () => {
      throw new Error("should not commit");
    });
    const exit = createNameWallSceneExit({
      getLayerGroups: () => namesOff(),
      commitLayers,
    });
    expect(exit.needsFade()).toBe(false);
    await expect(exit.fadeOutIfShown()).resolves.toBe(true);
    expect(commitLayers).not.toHaveBeenCalled();
  });
});

describe("createNameFieldExitGate", () => {
  test("holds destination layers until the name-field fade finishes, including mid-stagger", async () => {
    let releaseFade;
    const fadeOut = vi.fn(() => new Promise((resolve) => { releaseFade = resolve; }));
    const gate = createNameFieldExitGate({ fadeOut });

    expect(gate.holdUntilHidden(namesOn())).toBe(true);
    expect(fadeOut).not.toHaveBeenCalled();

    const leaving = gate.holdUntilHidden(home());
    let applied = false;
    leaving.then((ok) => { applied = ok; });
    await Promise.resolve();
    expect(fadeOut).toHaveBeenCalledOnce();
    expect(applied).toBe(false);

    releaseFade();
    await expect(leaving).resolves.toBe(true);
    expect(applied).toBe(true);
  });

  test("skips the hold when names were never drawn", async () => {
    const fadeOut = vi.fn(async () => {});
    const gate = createNameFieldExitGate({ fadeOut });
    expect(gate.holdUntilHidden(home())).toBe(true);
    expect(fadeOut).not.toHaveBeenCalled();
  });
});

describe("curated refresh holds destination layers for the name fade", () => {
  test("GIS does not apply home layers until fadeOut settles", async () => {
    const map = createFakeMapLibreMap();
    let releaseFade;
    const fadeOut = vi.fn(() => new Promise((resolve) => { releaseFade = resolve; }));
    const applyLayerGroups = vi.fn();
    const { refreshCuratedLayers } = createGisCuratedRefresh({
      map,
      applyLayerGroups,
      nameFieldController: { sync() {}, fadeOut },
    });

    await refreshCuratedLayers({ groupsOverride: namesOn(), syncFlow: false });
    expect(applyLayerGroups).toHaveBeenCalledTimes(1);

    const leaving = refreshCuratedLayers({ groupsOverride: home(), syncFlow: false });
    await Promise.resolve();
    expect(fadeOut).toHaveBeenCalledOnce();
    expect(applyLayerGroups).toHaveBeenCalledTimes(1);

    releaseFade();
    await leaving;
    expect(applyLayerGroups).toHaveBeenCalledTimes(2);
    expect(applyLayerGroups.mock.calls[1][0]).toEqual(home());
  });

  test("projection does not restore home layers until fadeOut settles", async () => {
    const map = createFakeMapLibreMap();
    let releaseFade;
    const fadeOut = vi.fn(() => new Promise((resolve) => { releaseFade = resolve; }));
    const syncProjectionLayersWithNarrative = vi.fn();
    const updateModelVisibility = vi.fn();
    const { applyProjectionRefresh } = createProjectionCuratedRefresh({
      map,
      updateModelVisibility,
      syncProjectionLayersWithNarrative,
      nameFieldController: { sync() {}, fadeOut },
      getNarrativeController: () => ({ onStyleLoad() {} }),
    });

    await applyProjectionRefresh({ groupsOverride: namesOn() });
    expect(syncProjectionLayersWithNarrative).toHaveBeenCalledTimes(1);
    expect(updateModelVisibility).toHaveBeenCalledTimes(1);

    const leaving = applyProjectionRefresh({ groupsOverride: home() });
    await Promise.resolve();
    expect(fadeOut).toHaveBeenCalledOnce();
    expect(syncProjectionLayersWithNarrative).toHaveBeenCalledTimes(1);
    expect(updateModelVisibility).toHaveBeenCalledTimes(1);

    releaseFade();
    await leaving;
    expect(syncProjectionLayersWithNarrative).toHaveBeenCalledTimes(2);
    expect(updateModelVisibility).toHaveBeenCalledTimes(2);
  });
});
