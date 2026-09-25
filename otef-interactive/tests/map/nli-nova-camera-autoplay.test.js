import { expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { createGisNarrativeController } from "../../frontend/src/map/nli-narrative-controller.js";
import {
  disposeInvestigationTimelineForMap,
  INVESTIGATION_POLYGONS_FULL_ID,
  syncInvestigationTimelineToMap,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { NLI_NARRATIVES } from "../../frontend/src/shared/nli-narratives.js";
import { NLI_NOVA_STORY } from "../../frontend/src/shared/nli-nova-story.js";
import { idleNliClock, playNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";

test("natural Nova playback crossing 12 seconds changes camera without a clock update", async () => {
  let now = 0;
  const map = createFakeMapLibreMap({
    layers: [
      { id: "nli__investigation_polygons__fill__0", type: "fill", source: "nli__investigation_polygons", paint: { "fill-opacity": 0.4 } },
      { id: "nli__investigation_polygons__line__1", type: "line", source: "nli__investigation_polygons", paint: { "line-opacity": 1 } },
    ],
    sources: { nli__investigation_polygons: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
  });
  map.flyTo = vi.fn();
  map.stop = vi.fn();
  map.setFilter = vi.fn();
  const clock = playNliClock(
    idleNliClock(),
    [INVESTIGATION_POLYGONS_FULL_ID],
    NLI_NOVA_STORY.representativeMinutes,
    0,
  );
  const dataContext = {
    getEscapeOverlay: () => ({ mor: false }),
    getInvestigationClock: () => clock,
    correctedNow: () => now,
    subscribe: () => () => {},
  };
  const controller = createGisNarrativeController({
    map,
    dataContext,
    viewportSync: { beginCameraTravel: vi.fn() },
    storage: { getItem: () => null, setItem: vi.fn() },
  });
  controller.apply({ id: "nova", transition: "enter", revision: 1 });
  expect(map.flyTo).toHaveBeenCalledWith({
    center: NLI_NARRATIVES.nova.center,
    zoom: 15,
    essential: true,
    duration: 1600,
  });

  await syncInvestigationTimelineToMap(map, clock, [{
    id: "nli",
    layers: [{ id: "investigation_polygons", enabled: true }],
  }], {
    featuresById: {
      [INVESTIGATION_POLYGONS_FULL_ID]: [{
        type: "Feature",
        properties: { OBJECTID: 100, timeline_minutes: 492, Notes: "Nova" },
        geometry: { type: "Polygon", coordinates: [[[34.46, 31.39], [34.461, 31.39], [34.461, 31.391], [34.46, 31.39]]] },
      }],
    },
    polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [] } },
    bufferedGradientFeatures: [],
    bufferedGradientSidecarStatus: "ready",
    narrativeFocus: NLI_NARRATIVES.nova,
    now: () => now,
    onClockFrame: (currentClock, frameNow) => controller.syncInvestigationClock(currentClock, frameNow),
  });

  map.flyTo.mockClear();
  now = 12_001;
  expect(map.driveAnimationFrame(now)).toBe(true);
  expect(map.flyTo).toHaveBeenCalledWith({
    zoom: NLI_NARRATIVES.nova.beat4Zoom,
    essential: true,
    duration: 1000,
  });

  controller.dispose();
  disposeInvestigationTimelineForMap(map);
});
