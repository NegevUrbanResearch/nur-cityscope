import { describe, expect, test } from "vitest";
import { resolveProjectionRoadSignVisibility } from "../../frontend/src/projection/projection-road-sign-visibility.js";
import { getEnabledMapFullLayerIds } from "../../frontend/src/map/maplibre-layer-manager.js";

const roadGroup = (enabled, id = "ציר_232") => ({ id: "nli", enabled: true, layers: [{ id, enabled }] });
const victimNames = { id: "nli", enabled: true, layers: [
  { id: "people_names", enabled: true }, { id: "ציר_232", enabled: true },
] };

function visibility({ liveGroups, committedGroups, presentationActive = true, calibrationActive = false, patternActive = false }) {
  return resolveProjectionRoadSignVisibility({ liveGroups, incomingGroups: committedGroups,
    presentationActive, calibrationActive, patternActive });
}

describe("Road 232 production visibility resolution", () => {
  test("follows the rendered road when the group flag is off but the layer is on", () => {
    const liveGroups = [{ id: "nli", enabled: false, layers: [{ id: "ציר_232", enabled: true }] }];
    expect(getEnabledMapFullLayerIds(liveGroups).has("nli.ציר_232")).toBe(true);
    expect(visibility({ liveGroups, presentationActive: false }).eligible).toBe(true);
  });

  test.each([false, true])("stays hidden when the road layer is off with group flag %s", (enabled) => {
    const liveGroups = [{ id: "nli", enabled, layers: [{ id: "ציר_232", enabled: false }] }];
    expect(getEnabledMapFullLayerIds(liveGroups).has("nli.ציר_232")).toBe(false);
    expect(visibility({ liveGroups, presentationActive: false }).eligible).toBe(false);
  });

  test("uses committed presentation visibility when the live road is on and the committed road is off", () => {
    const liveGroups = [roadGroup(true)];
    const committedGroups = [roadGroup(false)];
    const result = visibility({ liveGroups, committedGroups });
    expect(result.overlayGroups).toEqual(committedGroups);
    expect(result.eligible).toBe(false);
  });

  test("uses committed presentation visibility when the live road is off and the committed road is on", () => {
    const liveGroups = [roadGroup(false)];
    const committedGroups = [roadGroup(true, "nli.ציר_232")];
    const result = visibility({ liveGroups, committedGroups });
    expect(result.overlayGroups).toEqual(committedGroups);
    expect(result.eligible).toBe(true);
  });

  test("applies victim-name isolation after resolving a committed visible road", () => {
    const committedGroups = [victimNames];
    const result = visibility({ liveGroups: [roadGroup(false)], committedGroups });
    expect(result.overlayGroups[0].layers[1].enabled).toBe(true);
    expect(result.eligible).toBe(false);
  });

  test("uses live groups after presentation ends and restores signs when eligible", () => {
    expect(visibility({ liveGroups: [roadGroup(true)], committedGroups: [roadGroup(false)], presentationActive: false }).eligible).toBe(true);
    expect(visibility({ liveGroups: [roadGroup(false)], committedGroups: [roadGroup(true)], presentationActive: false }).eligible).toBe(false);
  });

  test("hides during calibration and patterns, then restores after they end", () => {
    const eligible = { liveGroups: [roadGroup(true)], committedGroups: [roadGroup(true)] };
    expect(visibility({ ...eligible, calibrationActive: true }).eligible).toBe(false);
    expect(visibility({ ...eligible, patternActive: true }).eligible).toBe(false);
    expect(visibility(eligible).eligible).toBe(true);
  });
});
