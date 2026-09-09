import { describe, expect, it, vi } from "vitest";
import { achievedSettlementCitynames } from "../../frontend/src/shared/nli-settlement-orientation.js";

describe("achievedSettlementCitynames", () => {
  it("strips kibbutz prefix and warns on עין הבשור", () => {
    const features = [
      { properties: { outlineObjectId: 1, locations: ["קיבוץ ארז"] } },
      { properties: { outlineObjectId: 2, locations: ["עין הבשור"] } },
    ];
    const knownCitynames = new Set(["ארז", "זיקים"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const names = achievedSettlementCitynames(["1", "2"], features, knownCitynames);
    expect(names.has("ארז")).toBe(true);
    expect(names.has("עין הבשור")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    achievedSettlementCitynames(["1", "2"], features, knownCitynames);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not light a sidecar location that is absent from שמות cityname", () => {
    const features = [{ properties: { outlineObjectId: 1, locations: ["מקום בדוי"] } }];
    const names = achievedSettlementCitynames(["1"], features, new Set(["ארז"]));
    expect(names.size).toBe(0);
  });

  it("lights a shared cityname if either outline is achieved", () => {
    const features = [
      { properties: { outlineObjectId: 1, locations: ["ארז"] } },
      { properties: { outlineObjectId: 2, locations: ["ארז"] } },
    ];
    const names = achievedSettlementCitynames(["2"], features, new Set(["ארז"]));
    expect(names.has("ארז")).toBe(true);
  });
});
