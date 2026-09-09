import { describe, expect, it, vi } from "vitest";
import {
  PROJECTION_LAB_CHROME_Z_INDEX,
  dispatchProjectionDisplayHotkey,
  readProjectionDisplayHotkey,
} from "../../frontend/src/projection/projection-display-hotkeys.js";

function keyEvent(key, extras = {}) {
  return {
    key,
    defaultPrevented: false,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: extras.target || { tagName: "BODY" },
    ...extras,
  };
}

describe("projection display hotkeys", () => {
  it("treats A and H as help even when a clock-debug input is focused", () => {
    const input = { tagName: "INPUT" };
    expect(readProjectionDisplayHotkey(keyEvent("a", { target: input }))).toBe("help");
    expect(readProjectionDisplayHotkey(keyEvent("A", { target: input }))).toBe("help");
    expect(readProjectionDisplayHotkey(keyEvent("h", { target: input }))).toBe("help");
  });

  it("treats L as label debug even when an input is focused", () => {
    expect(readProjectionDisplayHotkey(keyEvent("l", { target: { tagName: "INPUT" } }))).toBe(
      "labelDebug",
    );
  });

  it("sits above the cartographic legend z-index", () => {
    expect(PROJECTION_LAB_CHROME_Z_INDEX).toBeGreaterThan(1000);
  });

  it("dispatches help and label debug", () => {
    const toggleHelp = vi.fn();
    const toggleLabelDebug = vi.fn();
    expect(
      dispatchProjectionDisplayHotkey("help", { toggleHelp, toggleLabelDebug }),
    ).toBe(true);
    expect(toggleHelp).toHaveBeenCalledTimes(1);
    expect(dispatchProjectionDisplayHotkey("labelDebug", { toggleHelp, toggleLabelDebug })).toBe(
      true,
    );
    expect(toggleLabelDebug).toHaveBeenCalledTimes(1);
  });
});
