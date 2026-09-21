import { describe, expect, it } from "vitest";
import { packLegendPages } from "../../frontend/src/map/legend-pagination.js";

describe("packLegendPages", () => {
  it("packs measured blocks greedily and keeps exact fits", () => {
    expect(packLegendPages([
      { id: "a", height: 40 },
      { id: "b", height: 40 },
      { id: "c", height: 40 },
    ], 80)).toEqual({ pages: [["a", "b"], ["c"]], oversizedBlockIds: [] });
  });

  it("keeps an oversized block visible on its own page", () => {
    expect(packLegendPages([
      { id: "small", height: 20 },
      { id: "huge", height: 81 },
      { id: "last", height: 20 },
    ], 80)).toEqual({ pages: [["small"], ["huge"], ["last"]], oversizedBlockIds: ["huge"] });
  });

  it("keeps measured two-column continuation fragments together in reading order", () => {
    const blocks = [
      { id: "roads#item-a", height: 72 }, // repeated pack/layer heading plus two wrapped rows
      { id: "roads#item-c", height: 68 },
      { id: "parks", height: 40 },
    ];
    const result = packLegendPages(blocks, 140);
    expect(result.pages).toEqual([["roads#item-a", "roads#item-c"], ["parks"]]);
    expect(result.pages.flat()).toEqual(blocks.map((block) => block.id));
    expect(new Set(result.pages.flat()).size).toBe(blocks.length);
  });

  it("keeps an oversized wrapped row before the following row", () => {
    const result = packLegendPages([
      { id: "layer#long-label", height: 121 },
      { id: "layer#second-row", height: 55 },
    ], 120);
    expect(result).toEqual({
      pages: [["layer#long-label"], ["layer#second-row"]],
      oversizedBlockIds: ["layer#long-label"],
    });
  });

  it("does not recombine same-pack GIS fragments that were split to fit two rows", () => {
    const result = packLegendPages([
      { id: "roads#a", height: 100, groupId: "roads" },
      { id: "roads#b", height: 100, groupId: "roads" },
      { id: "parks", height: 40, groupId: "parks" },
    ], 250);
    expect(result.pages).toEqual([["roads#a"], ["roads#b", "parks"]]);
    expect(result.oversizedBlockIds).toEqual([]);
  });
});
