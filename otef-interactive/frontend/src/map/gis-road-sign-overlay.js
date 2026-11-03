import { loadRoadSignArtwork, reportRoadSignError } from "../projection/projection-road-sign-adapter.js";
import { paintRoadSigns } from "../projection/road-sign-painter.js";
import { shouldShowRoadSigns, validateRoadSignSettings } from "../shared/road-sign-settings.js";
import { projectGisRoadSigns } from "./gis-road-sign-geography.js";

/** Paint geographically anchored signs through the GIS map's current camera. */
export function createGisRoadSignOverlay({ map, container, dataContext, getHomeCamera, getGroups = () => [] } = {}) {
  let disposed = false;
  let signs = [];
  let eligible = false;
  const canvas = container.ownerDocument.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  canvas.className = "gis-road-sign-overlay";
  canvas.setAttribute("aria-label", "Road 232 signs");
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "4" });
  const context = canvas.getContext("2d");
  const artwork = {};
  const loads = ["dark", "original"].map(theme => loadRoadSignArtwork(container.ownerDocument, theme));
  const draw = () => {
    if (disposed) return;
    const width = container.clientWidth, height = container.clientHeight;
    canvas.hidden = !eligible || !signs.some(sign => sign.visible && artwork[sign.theme]) || !(width > 0 && height > 0);
    const projected = canvas.hidden ? [] : projectGisRoadSigns(signs, map, getHomeCamera(), width, height);
    paintRoadSigns(context, { signs: projected, artwork });
  };
  const sync = () => {
    if (disposed) return;
    const checked = validateRoadSignSettings(dataContext.getRoadSigns?.()?.settings);
    signs = checked.valid ? checked.settings.outputs.gis || [] : [];
    eligible = shouldShowRoadSigns({ effectiveGroups: getGroups() });
    draw();
  };
  container.appendChild(canvas);
  const unsubscribe = dataContext.subscribe?.("roadSigns", sync);
  map.on("move", draw);
  map.on("resize", draw);
  sync();
  const ready = Promise.all(loads.map(load => load.promise)).then(results => {
    if (disposed) return;
    results.forEach((result, index) => {
      artwork[index === 0 ? "dark" : "original"] = result.image;
      if (result.error) reportRoadSignError(result.error);
    });
    draw();
  });
  return {
    sync,
    ready: () => ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      map.off("move", draw);
      map.off("resize", draw);
      loads.forEach(load => load.cancel());
      canvas.remove();
    },
  };
}
