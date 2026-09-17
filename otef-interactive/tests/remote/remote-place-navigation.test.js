import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, installDom, places } from "./remote-navigation-fixtures.js";

describe("remote place navigation", () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("placeIsWithinRemoteBounds uses the table polygon when a camera hint exists", async () => {
    const { placeIsWithinRemoteBounds } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );
    expect(placeIsWithinRemoteBounds({}, {})).toBe(true);
    expect(
      placeIsWithinRemoteBounds(places[0], {
        getBounds: () => [[]],
        _pointInPolygon: vi.fn(() => false),
      }),
    ).toBe(false);
    expect(
      placeIsWithinRemoteBounds(places[0], {
        getBounds: () => [[]],
        _pointInPolygon: vi.fn(() => true),
      }),
    ).toBe(true);
  });

  test("focus shows starter suggestions and selection calls dataContext.navigateToPlace", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );
    const dataContext = { navigateToPlace: vi.fn().mockResolvedValue({ ok: true }) };

    initRemotePlaceNavigation({
      dataContext,
      searchPlaces: vi.fn(() => [places[0]]),
      isConnected: () => true,
    });

    document.getElementById("placeSearchInput").dispatchEvent({ type: "focus" });
    expect(document.querySelectorAll(".place-suggestion")).toHaveLength(1);
    expect(document.getElementById("placeSearchInput").getAttribute("aria-activedescendant")).toBe("place-option-yeshuv-0067");

    document.querySelector(".place-suggestion").dispatchEvent({ type: "click" });
    expect(dataContext.navigateToPlace).toHaveBeenCalledWith(places[0]);
  });

  test("clear button resets input and list", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );

    const cancelNavigationFocus = vi.fn().mockResolvedValue({ ok: true });
    initRemotePlaceNavigation({
      dataContext: { navigateToPlace: vi.fn(), cancelNavigationFocus },
      searchPlaces: vi.fn(() => [places[0]]),
      isConnected: () => true,
    });

    const input = document.getElementById("placeSearchInput");
    input.value = "or";
    input.dispatchEvent({ type: "input" });
    expect(document.querySelectorAll(".place-suggestion")).toHaveLength(1);

    document.getElementById("placeSearchClear").click();
    expect(input.value).toBe("");
    expect(document.querySelectorAll(".place-suggestion")).toHaveLength(0);
    expect(cancelNavigationFocus).toHaveBeenCalledOnce();
  });

  test("connection changes enable search and unsubscribe on destroy", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );
    let connected = false;
    let onConnection;
    const unsubscribe = vi.fn();
    const dataContext = { subscribe: vi.fn((topic, callback) => {
      if (topic === "connection") {
        onConnection = callback;
        return unsubscribe;
      }
      return () => {};
    }) };
    const controller = initRemotePlaceNavigation({ dataContext, isConnected: () => connected });
    const input = document.getElementById("placeSearchInput");
    expect(input.getAttribute("aria-disabled")).toBe("true");
    connected = true;
    onConnection(true);
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-disabled")).toBe("false");
    expect(document.getElementById("placeSearchStatus").textContent).toBe("");
    controller.destroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  test("resolved navigation failure shows placeSearchFailed", async () => {
    const [{ initRemotePlaceNavigation }, { t }] = await Promise.all([
      import("../../frontend/src/remote/remote-place-navigation.js"),
      import("../../frontend/src/remote/remote-locale.js"),
    ]);
    const dataContext = { navigateToPlace: vi.fn().mockResolvedValue({ ok: false }) };

    initRemotePlaceNavigation({
      dataContext,
      searchPlaces: vi.fn(() => [places[0]]),
      isConnected: () => true,
    });

    document.getElementById("placeSearchInput").dispatchEvent({ type: "focus" });
    document.querySelector(".place-suggestion").dispatchEvent({ type: "click" });
    await Promise.resolve();

    expect(dataContext.navigateToPlace).toHaveBeenCalledWith(places[0]);
    expect(document.getElementById("placeSearchStatus").textContent).toBe(
      t("placeSearchFailed"),
    );
  });

  test("suggestions and selection share the same live navigation guard", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );
    const dataContext = { navigateToPlace: vi.fn().mockResolvedValue({ ok: true }) };
    const searchPlaces = vi.fn((query, options) =>
      places.filter((place) => options.canNavigateToPlace(place) !== false),
    );

    initRemotePlaceNavigation({
      dataContext,
      searchPlaces,
      isConnected: () => true,
      canNavigateToPlace: (place) => place.id !== "yeshuv-0069",
    });

    const input = document.getElementById("placeSearchInput");
    input.value = "a";
    input.dispatchEvent({ type: "input" });

    const suggestions = document.querySelectorAll(".place-suggestion");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].textContent).toBe("אור הנר");
    expect(searchPlaces).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({
        canNavigateToPlace: expect.any(Function),
      }),
    );
  });

  test("clicking outside the search group closes the suggestions list", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );

    initRemotePlaceNavigation({
      dataContext: { navigateToPlace: vi.fn() },
      searchPlaces: vi.fn(() => [places[0], places[1]]),
      isConnected: () => true,
    });

    const input = document.getElementById("placeSearchInput");
    input.dispatchEvent({ type: "focus" });

    expect(document.querySelectorAll(".place-suggestion")).toHaveLength(2);
    expect(input.getAttribute("aria-expanded")).toBe("true");

    document.dispatchEvent({
      type: "pointerdown",
      target: createElement("outside"),
      composedPath: () => [createElement("outside")],
    });

    expect(document.querySelectorAll(".place-suggestion")).toHaveLength(0);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("placeSearchStatus").textContent).toBe("");
  });

  test("destroy removes outside-click listener", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );

    const controller = initRemotePlaceNavigation({
      dataContext: { navigateToPlace: vi.fn() },
      searchPlaces: vi.fn(() => [places[0], places[1]]),
      isConnected: () => true,
    });

    const input = document.getElementById("placeSearchInput");
    input.dispatchEvent({ type: "focus" });
    expect(document.querySelectorAll(".place-suggestion")).toHaveLength(2);

    controller.destroy();
    document.dispatchEvent({
      type: "pointerdown",
      target: createElement("outside"),
      composedPath: () => [createElement("outside")],
    });

    expect(document.querySelectorAll(".place-suggestion")).toHaveLength(2);
  });

});
