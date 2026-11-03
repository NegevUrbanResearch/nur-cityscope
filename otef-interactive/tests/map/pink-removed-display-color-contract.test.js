import { describe, it, expect } from "vitest";
import { routeLineStylesForDisplayColor } from "../../frontend/src/map-utils/pink-route-map-styles.js";

describe("removed segments ignore submission display_color", () => {
  it("oldLine color is default pink even when display color is palette red", () => {
    const styles = routeLineStylesForDisplayColor("#DC2626");
    expect(styles.oldLine.color.toLowerCase()).toBe("#ff69b4");
    expect(styles.solidLine.color.toUpperCase()).toBe("#FF69B4");
    expect(styles.proposedLine.color.toUpperCase()).toBe("#DC2626");
  });
});
