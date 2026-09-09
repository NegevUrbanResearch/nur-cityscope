/**
 * One integer text-rotate heading for nli.people_names and projection שמות labels.
 * Per-feature offsets stay on GeoJSON; live rotate is this heading, not otef_label_rotate_deg.
 */

export const NLI_LABEL_HEADING_STORAGE_KEY = "otef.nliLabelHeading.v1";
export const NLI_LABEL_HEADING_DEFAULT = 41;
export const PEOPLE_NAMES_LABEL_LAYER_ID = "nli__people_names__labels";
export const SHEMOT_LABEL_LAYER_ID = "projector_base__שמות_יישובים__labels";

const SHARED_LABEL_LAYER_IDS = [PEOPLE_NAMES_LABEL_LAYER_ID, SHEMOT_LABEL_LAYER_ID];

/** @param {unknown} deg */
export function snapNliLabelHeadingDeg(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return NLI_LABEL_HEADING_DEFAULT;
  return Math.round(n);
}

/** @param {{ getItem?: (key: string) => string | null } | null | undefined} storage */
export function readNliLabelHeading(storage) {
  if (!storage || typeof storage.getItem !== "function") {
    return NLI_LABEL_HEADING_DEFAULT;
  }
  try {
    const raw = storage.getItem(NLI_LABEL_HEADING_STORAGE_KEY);
    if (raw == null || raw === "") {
      return NLI_LABEL_HEADING_DEFAULT;
    }
    return snapNliLabelHeadingDeg(raw);
  } catch {
    return NLI_LABEL_HEADING_DEFAULT;
  }
}

/**
 * @param {unknown} deg
 * @param {{ setItem?: (key: string, value: string) => void } | null | undefined} storage
 */
export function writeNliLabelHeading(deg, storage) {
  const snapped = snapNliLabelHeadingDeg(deg);
  if (storage && typeof storage.setItem === "function") {
    try {
      storage.setItem(NLI_LABEL_HEADING_STORAGE_KEY, String(snapped));
    } catch {
      /* quota / private mode */
    }
  }
  return snapped;
}

/**
 * @param {{ getLayer?: (id: string) => unknown, setLayoutProperty?: (id: string, key: string, value: unknown) => void } | null | undefined} map
 * @param {unknown} headingDeg
 */
export function applyNliSharedTextHeading(map, headingDeg) {
  const snapped = snapNliLabelHeadingDeg(headingDeg);
  if (!map || typeof map.setLayoutProperty !== "function") return snapped;
  for (const id of SHARED_LABEL_LAYER_IDS) {
    if (typeof map.getLayer === "function" && !map.getLayer(id)) continue;
    try {
      map.setLayoutProperty(id, "text-rotate", snapped);
      map.setLayoutProperty(id, "text-rotation-alignment", "map");
    } catch {
      /* layer absent mid style swap */
    }
  }
  return snapped;
}

/** @param {unknown} headingDeg */
export function buildNliLabelHeadingExport(headingDeg) {
  return { version: 2, headingDeg: snapNliLabelHeadingDeg(headingDeg) };
}
