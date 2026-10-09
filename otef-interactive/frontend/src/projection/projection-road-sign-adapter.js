import { emptyRoadSignSettings, validateRoadSignSettings } from "../shared/road-sign-settings.js";
import { paintRoadSigns } from "./road-sign-painter.js";

const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const FULL_CLIP = [0, 0, 1, 1];
const ARTWORK_URLS = {
  original: new URL("../../img/projection-signs/road-232-original.svg", import.meta.url).href,
  dark: new URL("../../img/projection-signs/road-232-dark.svg", import.meta.url).href,
};

export function loadRoadSignArtwork(document, theme) {
  let image = null;
  let settled = false;
  let resolveLoad;
  const promise = new Promise((resolve) => { resolveLoad = resolve; });
  const finish = (error = null, cancelled = false) => {
    if (settled) return;
    settled = true;
    const loaded = !error && !cancelled && image?.naturalWidth > 0 ? image : null;
    if (image) {
      image.onload = null;
      image.onerror = null;
    }
    const result = { image: loaded, error: cancelled ? null : error || (loaded ? null : new Error(`Road 232 ${theme} artwork failed to load`)) };
    image = null;
    resolveLoad(result);
  };
  try {
    image = document?.createElement?.("img");
    if (!image) throw new Error("Road 232 artwork image is unavailable");
    image.onload = () => finish();
    image.onerror = () => finish(new Error(`Road 232 ${theme} artwork failed to load`));
    image.src = ARTWORK_URLS[theme];
    if (typeof image.decode === "function") {
      image.decode().then(() => finish(), (error) => finish(error));
    } else if (image.complete) finish();
  } catch (error) {
    finish(error);
  }
  return {
    promise,
    cancel() {
      if (settled) return;
      const pending = image;
      if (pending) {
        pending.onload = null;
        pending.onerror = null;
        pending.removeAttribute?.("src");
      }
      finish(null, true);
    },
  };
}

export function reportRoadSignError(error, logger = console) {
  logger?.warn?.("Road 232 signs unavailable:", error);
}

function paintSignature(signs, artwork) {
  return JSON.stringify(signs.filter((sign) => sign.visible && artwork[sign.theme]).map((sign) => ({
    id: sign.id, x: sign.x, y: sign.y, scale: sign.scale, rotateDeg: sign.rotateDeg,
    theme: sign.theme,
    leader: sign.leader?.enabled ? sign.leader : null,
  })));
}

export function createProjectionRoadSignAdapter({ document = globalThis.document, output, rasterScale = 1,
  onInvalidate = () => {}, onError = reportRoadSignError } = {}) {
  const canvas = document?.createElement?.("canvas");
  if (!canvas) throw new Error("Road 232 projection adapter requires canvas support");
  canvas.width = OUTPUT_WIDTH * rasterScale;
  canvas.height = OUTPUT_HEIGHT * rasterScale;
  const context = canvas.getContext?.("2d");
  if (!context) throw new Error("Road 232 projection adapter requires a 2d canvas");
  const artwork = { dark: null, original: null };
  let disposed = false;
  let readySettled = false;
  const artworkLoads = ["dark", "original"].map((theme) => loadRoadSignArtwork(document, theme));
  const readyPromise = Promise.all(artworkLoads.map((load) => load.promise))
    .then((results) => {
      if (disposed) return;
      ["dark", "original"].forEach((theme, index) => { artwork[theme] = results[index].image; });
      const failed = results.find((result) => result.error);
      if (failed) onError(failed.error);
    });
  let settings = emptyRoadSignSettings();
  let eligible = false;
  let contentVersion = 0;
  let paintedSignature = null;
  let descriptorCache = null;

  const descriptor = () => {
    if (disposed || !eligible || !readySettled) return null;
    const signs = settings.outputs[output] || [];
    if (!signs.some((sign) => sign.visible && artwork[sign.theme])) return null;
    const signature = paintSignature(signs, artwork);
    if (signature !== paintedSignature) {
      paintRoadSigns(context, { signs, artwork, rasterScale });
      paintedSignature = signature;
      contentVersion += 1;
      descriptorCache = { source: canvas, contentVersion, matrix: IDENTITY, clip: FULL_CLIP };
    }
    return descriptorCache;
  };
  readyPromise.then(() => {
    readySettled = true;
    if (disposed) return;
    onInvalidate();
  });

  return {
    setState({ settings: nextSettings, eligible: nextEligible } = {}) {
      if (disposed) return;
      const validated = validateRoadSignSettings(nextSettings ?? emptyRoadSignSettings());
      const normalized = validated.valid ? validated.settings : emptyRoadSignSettings();
      const isEligible = nextEligible === true;
      const previousSignature = JSON.stringify([settings, eligible]);
      const nextSignature = JSON.stringify([normalized, isEligible]);
      settings = normalized;
      eligible = isEligible;
      if (previousSignature !== nextSignature) {
        onInvalidate();
      }
    },
    descriptor,
    ready() { return readyPromise; },
    dispose() {
      if (disposed) return;
      disposed = true;
      artworkLoads.forEach((load) => load.cancel());
      artworkLoads.length = 0;
      context.clearRect(0, 0, canvas.width, canvas.height);
      descriptorCache = null;
      paintedSignature = null;
      artwork.dark = null;
      artwork.original = null;
    },
  };
}
