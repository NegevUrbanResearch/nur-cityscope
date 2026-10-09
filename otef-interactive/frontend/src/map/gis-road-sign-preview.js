import { createGisRoadSignOverlay } from "./gis-road-sign-overlay.js";
import { emptyRoadSignSettings, validateRoadSignSettings } from "../shared/road-sign-settings.js";
import { NLI_GIS_CLOCK_DEFAULT_LAYOUT } from "../projection/nli-explainer-overlay.js";
import { mountMapLegend } from "./map-legend.js";
import { positionGisLegend } from "./legend-integration.js";
import { gisRoadSignHomeCamera } from "./gis-road-sign-geography.js";
export { gisRoadSignHomeCamera } from "./gis-road-sign-geography.js";

const SCREEN_MESH = {
  width: 1920, height: 1080,
  vertices: [{ u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 1, y: 0 },
    { u: 1, v: 1, x: 1, y: 1 }, { u: 0, v: 1, x: 0, y: 1 }],
  triangles: [0, 1, 2, 0, 2, 3],
};

/** Adapt Road 232 placement requests to the isolated GIS Home renderer. */
export function createGisRoadSignPreview({ window: win, map, container, sessionId, snapshot, getGroups, registry, clockHost } = {}) {
  let settings = emptyRoadSignSettings();
  let disposed = false;
  const homeCamera = gisRoadSignHomeCamera(snapshot, win.proj4);
  const overlay = createGisRoadSignOverlay({ map, container, getHomeCamera: () => homeCamera, getGroups,
    dataContext: { getRoadSigns: () => ({ settings }) } });
  const legendElement = container.ownerDocument.getElementById("mapLegend");
  const legend = mountMapLegend({ element: legendElement, surface: "gis", registry, dataContext: {
    getLayerGroups: getGroups, getLegendSettings: () => snapshot.legend_settings || {},
    getGazaBorderVisible: () => snapshot.gaza_border_visible === true,
  } });
  legend.setEditing(true);
  const post = message => win.parent?.postMessage?.({ sessionId, output: "gis", ...message }, win.location.origin);
  return {
    readState(event, lastRequestId) {
      const state = event.data;
      if (event.origin !== win.location.origin || event.source !== win.parent || state?.type !== "otef_road_sign_preview_state"
        || state.sessionId !== sessionId || !Number.isSafeInteger(state.requestId) || state.requestId <= 0 || state.requestId <= lastRequestId) return null;
      const checked = validateRoadSignSettings(state.settings);
      if (state.output !== "gis" || state.sceneId !== "home" || !checked.valid
        || !Number.isSafeInteger(state.calibrationRevision) || state.calibrationRevision < 0) throw new Error("Invalid GIS Road 232 Home preview request");
      settings = checked.settings;
      return { ...state, surface: "gis", element: "gis.start", sceneId: "home", output: null,
        language: snapshot.legend_settings?.language,
        clockLayout: { ...NLI_GIS_CLOCK_DEFAULT_LAYOUT, ...snapshot.nli_clock_layout?.gis?.start } };
    },
    sync: () => overlay.sync(),
    async ready() {
      await Promise.all([overlay.ready(), legend.refresh()]);
      if (disposed) return;
      positionGisLegend({ element: legendElement, clockElement: clockHost });
      post({ type: "otef_road_sign_preview_ready" });
    },
    rendered(state) {
      post({ type: "otef_road_sign_preview_rendered", requestId: state.requestId, sceneId: "home",
        calibrationRevision: state.calibrationRevision, meshIdentity: "gis-screen:1920x1080", mesh: SCREEN_MESH });
    },
    fail(requestId, error) {
      post({ type: "otef_road_sign_preview_error", requestId, message: error instanceof Error ? error.message : String(error) });
    },
    dispose() { disposed = true; overlay.dispose(); legend.dispose(); },
  };
}
