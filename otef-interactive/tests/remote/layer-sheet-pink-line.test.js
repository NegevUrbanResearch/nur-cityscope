import { describe, expect, test } from "vitest";
import {
  LayerSheetController,
  isPinkLineRouteSheetRow,
  orderMoreshetWorkshopSheetRows,
  renderLayerRow,
} from "../../frontend/src/remote/layer-sheet-controller.js";
import {
  PINK_LINE_PARKING_LAYER_ID,
  PINK_LINE_ROUTE_FULL_LAYER_ID,
  PINK_LINE_ROUTE_LAYER_ID,
} from "../../frontend/src/map-utils/curated-pink-axis-state.js";

function makePinkLineRow(enabled = false) {
  return {
    baseName: PINK_LINE_ROUTE_LAYER_ID,
    displayLabel: "Pink line",
    fullLayerIds: [PINK_LINE_ROUTE_FULL_LAYER_ID],
    layers: [
      {
        id: PINK_LINE_ROUTE_LAYER_ID,
        name: "Pink line",
        enabled,
      },
    ],
    enabled,
  };
}

describe("layer sheet workshop pink-line control", () => {
  test("isPinkLineRouteSheetRow detects the synthetic toggle row", () => {
    expect(
      isPinkLineRouteSheetRow(makePinkLineRow(), "curated_moresht_axis"),
    ).toBe(true);
    expect(
      isPinkLineRouteSheetRow(
        {
          fullLayerIds: ["curated_moresht_axis.55"],
          layers: [{ id: "55", name: "Demo", enabled: true }],
        },
        "curated_moresht_axis",
      ),
    ).toBe(false);
  });

  test("orderMoreshetWorkshopSheetRows pins the pink-line row first", () => {
    const ordered = orderMoreshetWorkshopSheetRows([
      {
        fullLayerIds: ["curated_moresht_axis.55"],
        layers: [{ id: "55", name: "A long workshop proposal name", enabled: false }],
      },
      makePinkLineRow(true),
      {
        fullLayerIds: [`curated_moresht_axis.${PINK_LINE_PARKING_LAYER_ID}`],
        layers: [{ id: PINK_LINE_PARKING_LAYER_ID, name: "Parking lots", enabled: false }],
      },
    ]);
    expect(ordered[0].fullLayerIds[0]).toBe(PINK_LINE_ROUTE_FULL_LAYER_ID);
  });

  test("renderLayerRow uses a distinct first-tile class and locale label", () => {
    const html = renderLayerRow(makePinkLineRow(true), {
      groupId: "curated_moresht_axis",
    });
    expect(html).toContain("layer-tile--pink-line");
    expect(html).toContain("layer-tile__swatch--pink-line");
    expect(html).toContain(PINK_LINE_ROUTE_FULL_LAYER_ID);
    expect(html).toMatch(/קו ורוד|Pink line/);
  });

  test("buildLayerRowsHtml emits the pink-line tile before workshop submissions", () => {
    const controller = Object.create(LayerSheetController.prototype);
    controller.primaryTileIdsJson = null;
    const html = controller.buildLayerRowsHtml(
      {
        id: "curated_moresht_axis",
        layers: [
          {
            id: "55",
            name: "A",
            enabled: false,
            fullLayerIds: ["curated_moresht_axis.55"],
          },
          {
            id: PINK_LINE_ROUTE_LAYER_ID,
            name: "Pink line",
            enabled: true,
            fullLayerIds: [PINK_LINE_ROUTE_FULL_LAYER_ID],
          },
          {
            id: PINK_LINE_PARKING_LAYER_ID,
            name: "Parking lots",
            enabled: false,
            fullLayerIds: [`curated_moresht_axis.${PINK_LINE_PARKING_LAYER_ID}`],
          },
        ],
      },
      {},
    );
    const firstTileIds = html.match(/data-layer-ids="([^"]+)"/);
    expect(firstTileIds).not.toBeNull();
    expect(decodeURIComponent(firstTileIds[1].replace(/&quot;/g, '"'))).toContain(
      PINK_LINE_ROUTE_FULL_LAYER_ID,
    );
  });
});
