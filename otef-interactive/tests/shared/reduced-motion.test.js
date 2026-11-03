import { describe, expect, test } from "vitest";
import { resolveMotionMode } from "../../frontend/src/shared/reduced-motion.js";

describe("resolveMotionMode", () => {
  test.each([
    [{ matchMedia: () => ({ matches: false }) }, "full"],
    [{ matchMedia: () => ({ matches: true }) }, "reduced"],
    [{}, "full"],
    [{ matchMedia: () => { throw new Error("unavailable"); } }, "full"],
  ])("returns %s for the browser preference result", (windowLike, expected) => {
    expect(resolveMotionMode(windowLike)).toBe(expected);
  });
});
