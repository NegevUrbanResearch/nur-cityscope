import { describe, expect, test } from "vitest";
import {
  OFFICIAL_NETWORK_GAP_METERS,
  STORED_PINK_ROUTE_OFFROAD_GAP_METERS,
  routeLineStylesForDisplayColor,
} from "../../frontend/src/map-utils/pink-route-map-styles.js";

describe("pink-route-map-styles", () => {
  test("exports OFFICIAL_NETWORK_GAP_METERS for Colab Google-leg vs chord heuristic", () => {
    expect(OFFICIAL_NETWORK_GAP_METERS).toBe(28);
  });

  test("exports STORED_PINK_ROUTE_OFFROAD_GAP_METERS for stored pink_line_route (not 28m)", () => {
    expect(STORED_PINK_ROUTE_OFFROAD_GAP_METERS).toBe(3500);
  });

  test("routeLineStylesForDisplayColor: valid 6-digit # hex sets proposedLine.color (normalized uppercase)", () => {
    const { proposedLine } = routeLineStylesForDisplayColor("#00ffaa");
    expect(proposedLine.color).toBe("#00FFAA");
    expect(proposedLine.weight).toBe(6);
    expect(proposedLine.opacity).toBe(0.95);
    expect(proposedLine.dashArray).toBe("3 7");
    expect(proposedLine.lineCap).toBe("round");
    expect(proposedLine.lineJoin).toBe("round");
  });

  test("routeLineStylesForDisplayColor: invalid or missing hex uses default proposed pink", () => {
    for (const bad of [null, undefined, "", "  ", "#gg0000", "#fff", "red", "#00ffaa00"]) {
      expect(routeLineStylesForDisplayColor(bad).proposedLine.color).toBe("#ff587b");
    }
  });

  test("solid and ghost strokes stay Colab fixed pinks regardless of display hex", () => {
    const styles = routeLineStylesForDisplayColor("#16A34A");
    expect(styles.solidLine).toMatchObject({
      color: "#FF69B4",
      weight: 5,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
    });
    expect(styles.oldLine).toMatchObject({
      color: "#ff69b4",
      weight: 4.5,
      opacity: 0.4,
      lineCap: "round",
      lineJoin: "round",
    });
    expect(styles.oldHalo).toMatchObject({
      color: "#ffffff",
      weight: 6.5,
      opacity: 0.32,
      lineCap: "round",
      lineJoin: "round",
    });
    expect(styles.proposedHalo).toMatchObject({
      color: "#ffffff",
      weight: 7,
      opacity: 0.22,
      lineCap: "round",
      lineJoin: "round",
    });
  });

  test("offroadLine matches Colab pinkDetourLeaflet tokens (no pane in style bag)", () => {
    const { offroadLine } = routeLineStylesForDisplayColor(null);
    expect(offroadLine).toEqual({
      color: "#C62828",
      weight: 4,
      opacity: 0.95,
      dashArray: "6 10",
      lineCap: "round",
      lineJoin: "round",
    });
  });

  test("returns independent objects per call", () => {
    const a = routeLineStylesForDisplayColor("#ABCDEF");
    const b = routeLineStylesForDisplayColor("#ABCDEF");
    expect(a.proposedLine).not.toBe(b.proposedLine);
    a.proposedLine.weight = 99;
    expect(b.proposedLine.weight).toBe(6);
  });
});
