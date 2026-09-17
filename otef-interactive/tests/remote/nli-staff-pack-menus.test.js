import { describe, expect, test, vi } from "vitest";
import {
  STAFF_PACK_IDS,
  createStaffPackMenus,
  labelForPackRow,
  packRowsFromGroup,
} from "../../frontend/src/remote/nli-staff-pack-menus.js";
import { setLocale } from "../../frontend/src/remote/remote-locale.js";

function htmlRoot() {
  const listeners = [];
  return {
    innerHTML: "",
    contains() {
      return true;
    },
    addEventListener(type, fn) {
      listeners.push({ type, fn });
    },
    removeEventListener(type, fn) {
      const index = listeners.findIndex((item) => item.type === type && item.fn === fn);
      if (index >= 0) listeners.splice(index, 1);
    },
    emit(type, event) {
      listeners.filter((item) => item.type === type).forEach((item) => item.fn(event));
    },
  };
}

describe("staff pack menus", () => {
  test("exposes the two exhibition packs and flattens merged fullLayerIds", () => {
    setLocale("en");
    expect(STAFF_PACK_IDS).toEqual(["nli", "projector_base"]);
    const rows = packRowsFromGroup({
      id: "projector_base",
      layers: [
        {
          id: "שמות_יישובים",
          name: "שמות",
          enabled: true,
          fullLayerIds: ["projector_base.שמות_יישובים", "projector_base.Locations_Lines"],
        },
        { id: "רקע_שחור", name: "Black", enabled: false },
      ],
    });
    expect(rows[0].fullLayerIds).toEqual([
      "projector_base.שמות_יישובים",
      "projector_base.Locations_Lines",
    ]);
    expect(rows[1].fullLayerIds).toEqual(["projector_base.רקע_שחור"]);
    expect(labelForPackRow(rows[1], "en")).toBe("Black background");
  });

  test("renders Library Content / Base Layers and toggles a layer row", async () => {
    setLocale("en");
    const root = htmlRoot();
    const setLayersEnabled = vi.fn().mockResolvedValue(undefined);
    const menus = createStaffPackMenus({
      root,
      getGroups: () => [
        {
          id: "nli",
          layers: [{ id: "people_names", name: "Names", enabled: false }],
        },
        {
          id: "projector_base",
          layers: [{ id: "רקע_שחור", name: "Black", enabled: true }],
        },
      ],
      getClock: () => ({ phase: "idle" }),
      setLayersEnabled,
      isConnected: () => true,
      titleForPack: (id) => (id === "nli" ? "Library Content" : "Base Layers"),
      emptyLabel: () => "No layers",
    });

    expect(root.innerHTML).toContain("Library Content");
    expect(root.innerHTML).toContain("Base Layers");

    root.emit("click", {
      target: {
        closest(selector) {
          return selector === "[data-pack-trigger]"
            ? { getAttribute: () => "nli" }
            : null;
        },
      },
    });
    expect(menus.getOpenId()).toBe("nli");
    expect(root.innerHTML).toContain("nli.people_names");

    const layerButton = {
      disabled: false,
      closest(selector) {
        return selector === "[data-layer-ids]" ? this : null;
      },
      getAttribute(name) {
        if (name === "data-layer-ids") return JSON.stringify(["nli.people_names"]);
        if (name === "aria-pressed") return "false";
        return null;
      },
    };
    root.emit("click", { target: layerButton });
    await Promise.resolve();
    expect(setLayersEnabled).toHaveBeenCalledWith(["nli.people_names"], true);

    menus.destroy();
  });

  test("locks playable NLI rows while the clock is running", () => {
    setLocale("en");
    const root = htmlRoot();
    const menus = createStaffPackMenus({
      root,
      getGroups: () => [
        {
          id: "nli",
          layers: [{ id: "investigation_polygons", name: "Polygons", enabled: true }],
        },
      ],
      getClock: () => ({ phase: "playing" }),
      setLayersEnabled: vi.fn(),
      isConnected: () => true,
      titleForPack: () => "Library Content",
    });

    root.emit("click", {
      target: {
        closest(selector) {
          return selector === "[data-pack-trigger]"
            ? { getAttribute: () => "nli" }
            : null;
        },
      },
    });
    expect(root.innerHTML).toContain("is-locked");
    expect(root.innerHTML).toContain("disabled");
    menus.destroy();
  });
});
