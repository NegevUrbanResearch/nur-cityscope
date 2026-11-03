import { describe, expect, test } from "vitest";
import {
  GHOST_REMOVED_HALO_OPACITY,
  GHOST_REMOVED_LINE_OPACITY,
  OFFICIAL_NETWORK_GAP_METERS,
  STORED_PINK_ROUTE_OFFROAD_GAP_METERS,
  pinkProjectionFallbackLineStyle,
  routeLineStylesForDisplayColor,
} from "../../frontend/src/map-utils/pink-route-map-styles.js";

describe("pink-route-map-styles", () => {
  test("exports OFFICIAL_NETWORK_GAP_METERS for Colab Google-leg vs chord heuristic", () => {
    expect(OFFICIAL_NETWORK_GAP_METERS).toBe(28);
  });

  test("exports STORED_PINK_ROUTE_OFFROAD_GAP_METERS for stored pink_line_route (not 28m)", () => {
    expect(STORED_PINK_ROUTE_OFFROAD_GAP_METERS).toBe(3500);
  });

  test("pinkProjectionFallbackLineStyle: Colab proposed dash + weight for MapLibre pink-projection fallback", () => {
    const s = pinkProjectionFallbackLineStyle("#00d4ff");
    expect(s.color).toBe("#00d4ff");
    expect(s.weight).toBe(6);
    expect(s.opacity).toBe(0.95);
    expect(s.dashArray).toBe("10 8");
    expect(s.lineCap).toBe("round");
    expect(s.lineJoin).toBe("round");
  });

  test("routeLineStylesForDisplayColor: palette allowlist sets proposedLine + proposedSecondary (Colab dual stack)", () => {
    const styles = routeLineStylesForDisplayColor("#16a34a");
    const { proposedLine, proposedSecondary } = styles;
    expect(proposedLine.color).toBe("#16A34A");
    expect(proposedLine.weight).toBe(6);
    expect(proposedLine.opacity).toBe(0.95);
    expect(proposedLine.dashArray).toBe("10 8");
    expect(proposedLine.dashOffset).toBe("9");
    expect(proposedLine.lineCap).toBe("butt");
    expect(proposedLine.lineJoin).toBe("miter");
    expect(proposedSecondary).toBeDefined();
    expect(proposedSecondary.color).toBe("#9333EA");
    expect(proposedSecondary.weight).toBe(6);
    expect(proposedSecondary.opacity).toBe(0.88);
    expect(proposedSecondary.dashArray).toBe("10 8");
    expect(proposedSecondary.dashOffset).toBeUndefined();
    expect(proposedSecondary.lineCap).toBe("butt");
    expect(proposedSecondary.lineJoin).toBe("miter");
  });

  test("routeLineStylesForDisplayColor: invalid or missing hex uses default proposed pink (no proposedSecondary)", () => {
    for (const bad of [null, undefined, "", "  ", "#gg0000", "#fff", "red", "#00ffaa00", "#00ffaa"]) {
      const s = routeLineStylesForDisplayColor(bad);
      expect(s.proposedLine.color).toBe("#ff587b");
      expect(s.proposedLine.dashArray).toBe("10 8");
      expect(s.proposedLine.lineCap).toBe("round");
      expect(s.proposedLine.lineJoin).toBe("round");
      expect(s.proposedSecondary).toBeUndefined();
    }
  });

  test("solidLine and axisPackLine share default numbers but are distinct objects", () => {
    for (const hex of [null, "#16A34A"]) {
      const styles = routeLineStylesForDisplayColor(hex);
      expect(styles.solidLine).not.toBe(styles.axisPackLine);
      expect(styles.axisPackLine).toMatchObject({
        color: styles.solidLine.color,
        weight: styles.solidLine.weight,
        opacity: styles.solidLine.opacity,
        lineCap: styles.solidLine.lineCap,
        lineJoin: styles.solidLine.lineJoin,
      });
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
    expect(styles.axisPackLine).toMatchObject({
      color: "#FF69B4",
      weight: 5,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
    });
    expect(styles.oldLine).toMatchObject({
      color: "#ff69b4",
      weight: 4.5,
      opacity: GHOST_REMOVED_LINE_OPACITY,
      lineCap: "round",
      lineJoin: "round",
    });
    expect(styles.oldHalo).toMatchObject({
      color: "#ffffff",
      weight: 5,
      opacity: GHOST_REMOVED_HALO_OPACITY,
      lineCap: "round",
      lineJoin: "round",
    });
    expect(styles.proposedHalo).toMatchObject({
      color: "#e8eef5",
      weight: 8,
      opacity: 0.32,
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
    const a = routeLineStylesForDisplayColor("#16A34A");
    const b = routeLineStylesForDisplayColor("#16A34A");
    expect(a.proposedLine).not.toBe(b.proposedLine);
    expect(a.proposedSecondary).not.toBe(b.proposedSecondary);
    expect(a.solidLine).not.toBe(b.solidLine);
    expect(a.axisPackLine).not.toBe(b.axisPackLine);
    a.proposedLine.weight = 99;
    a.proposedSecondary.weight = 88;
    expect(b.proposedLine.weight).toBe(6);
    expect(b.proposedSecondary.weight).toBe(6);
  });
});
