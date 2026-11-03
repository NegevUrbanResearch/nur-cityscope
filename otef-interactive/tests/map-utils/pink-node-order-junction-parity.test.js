import { describe, expect, test } from "vitest";
import { assignPinkNodeDisplayOrders } from "../../frontend/src/map-utils/pink-route-optimizer.js";

describe("assignPinkNodeDisplayOrders / pink_offroad_junction parity", () => {
  test("junction point is not numbered; pink_line_node features get 1 and 2", () => {
    const junction = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [34.8, 32.1] },
      properties: {
        curated_overlay_role: "pink_offroad_junction",
      },
    };
    const nodeA = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [34.81, 32.11] },
      properties: { feature_type: "pink_line_node" },
    };
    const nodeB = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [34.82, 32.12] },
      properties: { feature_type: "pink_line_node" },
    };

    const features = [junction, nodeA, nodeB];
    assignPinkNodeDisplayOrders(features);

    expect(junction.properties).not.toHaveProperty("pink_node_order");
    expect(nodeA.properties.pink_node_order).toBe(1);
    expect(nodeB.properties.pink_node_order).toBe(2);
  });
});
