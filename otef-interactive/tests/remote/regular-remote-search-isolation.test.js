import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, installDom, places } from "./remote-navigation-fixtures.js";

describe("regular settlement search isolation", () => {
  beforeEach(() => { vi.resetModules(); installDom(); });
  afterEach(() => vi.unstubAllGlobals());

  test("initializing regular navigation creates no people or archive interface or subscriptions", async () => {
    const { initRemotePlaceNavigation } = await import("../../frontend/src/remote/remote-place-navigation.js");
    const topics = [];
    const root = document.getElementById("placeSearchGroup");
    const controller = initRemotePlaceNavigation({ dataContext: {
      subscribe(topic) { topics.push(topic); return () => {}; },
    } });
    expect(root.children).toHaveLength(0);
    expect(topics).toEqual(["connection"]);
    controller.destroy();
  });

  test("a legacy people control cannot redirect regular search away from settlements", async () => {
    const { initRemotePlaceNavigation } = await import("../../frontend/src/remote/remote-place-navigation.js");
    const mode = createElement("legacyPeopleMode");
    mode.dataset = { searchMode: "people" };
    const root = document.getElementById("placeSearchGroup");
    root.querySelectorAll = () => [mode];
    const peopleRuntime = { load: vi.fn().mockResolvedValue(undefined), search: vi.fn(() => []) };
    const navigated = [];
    initRemotePlaceNavigation({
      dataContext: { navigateToPlace: async (place) => { navigated.push(place.id); return { ok: true }; } },
      searchPlaces: () => [places[0]], peopleRuntime,
    });
    mode.click();
    const input = document.getElementById("placeSearchInput");
    input.value = "אור";
    input.dispatchEvent({ type: "input" });
    expect(document.querySelectorAll(".place-suggestion")).toHaveLength(1);
    document.querySelector(".place-suggestion").click();
    expect(navigated).toEqual(["yeshuv-0067"]);
    expect(peopleRuntime.load).not.toHaveBeenCalled();
  });
});
