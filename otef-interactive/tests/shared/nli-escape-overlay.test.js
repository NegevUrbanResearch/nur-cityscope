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
      normalizeEscapeOverlay({ individual: false, overlap: true, mor: true }, "nova"),
    ).toEqual({ individual: false, overlap: true, mor: true, settled: false });
  });

  test("defaults missing Mor and settled flags for old Nova payloads", () => {
    expect(normalizeEscapeOverlay({ individual: true, overlap: false }, "nova")).toEqual({
      individual: true,
      overlap: false,
      mor: false,
      settled: false,
    });
    expect(normalizeEscapeOverlay({ individual: true, overlap: false, mor: true }, "nova")).toEqual({
      individual: true,
      overlap: false,
      mor: true,
      settled: false,
    });
  });

  test("rejects a supplied non-boolean settled flag", () => {
    expect(() => normalizeEscapeOverlay({ settled: "yes" }, "nova")).toThrow(/settled/);
    expect(() => normalizeEscapeOverlay({ individual: 1, overlap: false, mor: false, settled: false }, "nova"))
      .toThrow(/individual/);
  });

  test("settled clears animated flags", () => {
    expect(normalizeEscapeOverlay({
      individual: true,
      overlap: true,
      mor: true,
      settled: true,
    }, "nova")).toEqual({
      individual: false,
      overlap: false,
      mor: false,
      settled: true,
    });
  });

  test("enter defaults apply only when applyEnterDefaults is true and raw is empty", () => {
    expect(normalizeEscapeOverlay(null, "nova", { applyEnterDefaults: true })).toEqual(
      NOVA_ENTER_ESCAPE_OVERLAY,
    );
    expect(normalizeEscapeOverlay(null, "nova")).toEqual(EMPTY_ESCAPE_OVERLAY);
  });

  test("Nova enter overlay clears every flag including settled", () => {
    expect(NOVA_ENTER_ESCAPE_OVERLAY).toEqual({
      individual: false,
      overlap: false,
      mor: false,
      settled: false,
    });
    expect(NOVA_ENTER_ESCAPE_OVERLAY).toEqual(EMPTY_ESCAPE_OVERLAY);
    expect(normalizeEscapeOverlay(null, "nova", { applyEnterDefaults: true })).toEqual({
      individual: false,
      overlap: false,
      mor: false,
      settled: false,
    });
    expect(normalizeEscapeOverlay({ settled: true }, "segev")).toEqual(EMPTY_ESCAPE_OVERLAY);
  });
});
