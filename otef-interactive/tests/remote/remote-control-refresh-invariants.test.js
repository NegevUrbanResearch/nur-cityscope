import { describe, expect, test } from "vitest";
import { shouldReapplyDpadAfterFullControlRefresh } from "../../frontend/src/remote/remote-control-refresh-invariants.js";

describe("remote control refresh invariants", () => {
  test("re-applies dpad lock only while joystick is the active control", () => {
    expect(shouldReapplyDpadAfterFullControlRefresh(null)).toBe(false);
    expect(shouldReapplyDpadAfterFullControlRefresh("dpad")).toBe(false);
    expect(shouldReapplyDpadAfterFullControlRefresh("joystick")).toBe(true);
  });
});
