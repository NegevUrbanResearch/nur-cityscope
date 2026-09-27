import { describe, expect, it } from "vitest";
import { OTEF_MESSAGE_TYPES, validateMessage } from "../../frontend/src/shared/message-protocol.js";

describe("investigation clock protocol", () => {
  it("accepts otef_investigation_clock_changed", () => {
    expect(OTEF_MESSAGE_TYPES.INVESTIGATION_CLOCK_CHANGED).toBe(
      "otef_investigation_clock_changed",
    );
    expect(validateMessage({ type: "otef_investigation_clock_changed" })).toBe(true);
  });
});

describe("exhibit mode protocol", () => {
  it("accepts otef_exhibit_mode_changed", () => {
    expect(OTEF_MESSAGE_TYPES.EXHIBIT_MODE_CHANGED).toBe("otef_exhibit_mode_changed");
    expect(validateMessage({ type: "otef_exhibit_mode_changed" })).toBe(true);
  });
});
