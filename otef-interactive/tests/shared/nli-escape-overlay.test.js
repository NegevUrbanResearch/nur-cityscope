import { describe, expect, test } from "vitest";

import {
  EMPTY_ESCAPE_OVERLAY,
  NOVA_ENTER_ESCAPE_OVERLAY,
  normalizeEscapeOverlay,
} from "../../frontend/src/shared/nli-escape-overlay.js";

describe("normalizeEscapeOverlay", () => {
  test("zeros overlay when narrative is not nova", () => {
    expect(normalizeEscapeOverlay({ individual: true, overlap: true }, "segev")).toEqual(
      EMPTY_ESCAPE_OVERLAY,
    );
    expect(normalizeEscapeOverlay({ individual: true }, null)).toEqual(EMPTY_ESCAPE_OVERLAY);
  });

  test("hydrates existing nova booleans without re-applying enter defaults", () => {
    expect(
      normalizeEscapeOverlay({ individual: false, overlap: true }, "nova"),
    ).toEqual({ individual: false, overlap: true });
  });

  test("enter defaults apply only when applyEnterDefaults is true and raw is empty", () => {
    expect(normalizeEscapeOverlay(null, "nova", { applyEnterDefaults: true })).toEqual(
      NOVA_ENTER_ESCAPE_OVERLAY,
    );
    expect(normalizeEscapeOverlay(null, "nova")).toEqual(EMPTY_ESCAPE_OVERLAY);
  });

  test("Nova enter overlay is both flags false", () => {
    expect(NOVA_ENTER_ESCAPE_OVERLAY).toEqual({ individual: false, overlap: false });
    expect(NOVA_ENTER_ESCAPE_OVERLAY).toEqual(EMPTY_ESCAPE_OVERLAY);
    expect(normalizeEscapeOverlay(null, "nova", { applyEnterDefaults: true })).toEqual({
      individual: false,
      overlap: false,
    });
  });
});
