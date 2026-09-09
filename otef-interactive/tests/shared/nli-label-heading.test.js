import { describe, expect, it, vi } from "vitest";
import {
  NLI_LABEL_HEADING_DEFAULT,
  NLI_LABEL_HEADING_STORAGE_KEY,
  PEOPLE_NAMES_LABEL_LAYER_ID,
  SHEMOT_LABEL_LAYER_ID,
  applyNliSharedTextHeading,
  buildNliLabelHeadingExport,
  readNliLabelHeading,
  snapNliLabelHeadingDeg,
  writeNliLabelHeading,
} from "../../frontend/src/shared/nli-label-heading.js";

describe("nli shared label heading", () => {
  it("snaps to integer degrees with committed heading 41", () => {
    expect(snapNliLabelHeadingDeg(undefined)).toBe(41);
    expect(snapNliLabelHeadingDeg(NLI_LABEL_HEADING_DEFAULT)).toBe(41);
    expect(NLI_LABEL_HEADING_DEFAULT).toBe(41);
    expect(snapNliLabelHeadingDeg(14.4)).toBe(14);
    expect(snapNliLabelHeadingDeg(14.6)).toBe(15);
    expect(snapNliLabelHeadingDeg(-0.6)).toBe(-1);
  });

  it("persists one heading and exports a single headingDeg", () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    expect(readNliLabelHeading(storage)).toBe(41);
    writeNliLabelHeading(91.2, storage);
    expect(storage.setItem).toHaveBeenCalledWith(NLI_LABEL_HEADING_STORAGE_KEY, "91");
    storage.getItem = vi.fn(() => "91");
    expect(readNliLabelHeading(storage)).toBe(91);
    expect(buildNliLabelHeadingExport(91.2)).toEqual({ version: 2, headingDeg: 91 });
    expect(buildNliLabelHeadingExport(91.2)).not.toHaveProperty("overrides");
  });

  it("sets static text-rotate and map alignment on people_names and שמות layers", () => {
    const props = {};
    const map = {
      getLayer: (id) => id === PEOPLE_NAMES_LABEL_LAYER_ID || id === SHEMOT_LABEL_LAYER_ID,
      setLayoutProperty: vi.fn((id, key, value) => {
        props[`${id}:${key}`] = value;
      }),
    };
    applyNliSharedTextHeading(map, 12.4);
    expect(props[`${PEOPLE_NAMES_LABEL_LAYER_ID}:text-rotate`]).toBe(12);
    expect(props[`${PEOPLE_NAMES_LABEL_LAYER_ID}:text-rotation-alignment`]).toBe("map");
    expect(props[`${SHEMOT_LABEL_LAYER_ID}:text-rotate`]).toBe(12);
    expect(props[`${SHEMOT_LABEL_LAYER_ID}:text-rotation-alignment`]).toBe("map");
  });
});
