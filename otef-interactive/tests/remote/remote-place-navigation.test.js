import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function createElement(id = "") {
  const listeners = new Map();
  const children = [];

  const element = {
    id,
    value: "",
    textContent: "",
    hidden: false,
    children,
    className: "",
    attributes: {},
    ownerDocument: null,
    type: "",
    placeholder: "",
    dir: "",
    parentNode: null,
    focus: vi.fn(),
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) || [];
      for (const handler of handlers) {
        handler(event);
      }
    },
    click() {
      this.dispatchEvent({ type: "click" });
    },
    append(child) {
      child.parentNode = this;
      children.push(child);
    },
    replaceChildren(...nextChildren) {
      children.length = 0;
      nextChildren.forEach((child) => {
        child.parentNode = this;
      });
      children.push(...nextChildren);
    },
    querySelector(selector) {
      if (selector.startsWith("#")) return null;
      if (selector === ".place-suggestion") {
        return children.find((child) => child.className === "place-suggestion") || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".place-suggestion") {
        return children.filter((child) => child.className === "place-suggestion");
      }
      return [];
    },
  };

  return element;
}

let elements;
let documentListeners;

function installDom() {
  documentListeners = new Map();
  elements = {
    placeSearchGroup: createElement("placeSearchGroup"),
    placeSearchInput: createElement("placeSearchInput"),
    placeSearchClear: createElement("placeSearchClear"),
    placeSuggestions: createElement("placeSuggestions"),
    placeSearchStatus: createElement("placeSearchStatus"),
  };

  const documentStub = {
    addEventListener(type, handler) {
      const handlers = documentListeners.get(type) || [];
      handlers.push(handler);
      documentListeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      const handlers = documentListeners.get(type) || [];
      documentListeners.set(
        type,
        handlers.filter((registered) => registered !== handler),
      );
    },
    dispatchEvent(event) {
      const handlers = documentListeners.get(event.type) || [];
      for (const handler of handlers) {
        handler(event);
      }
    },
    getElementById: (id) => elements[id] || null,
    createElement: () => {
      const el = createElement();
      el.ownerDocument = documentStub;
      return el;
    },
    querySelector: (selector) => {
      if (selector === ".place-suggestion") {
        return (
          elements.placeSuggestions.children.find((child) => child.className === "place-suggestion") ||
          null
        );
      }
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === ".place-suggestion") {
        return elements.placeSuggestions.children.filter(
          (child) => child.className === "place-suggestion",
        );
      }
      return [];
    },
  };

  for (const element of Object.values(elements)) {
    element.ownerDocument = documentStub;
  }

  elements.placeSearchGroup.querySelector = (selector) =>
    selector.startsWith("#") ? elements[selector.slice(1)] || null : null;
  elements.placeSearchGroup.querySelectorAll = () => [];

  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

const places = [
  {
    id: "yeshuv-0067",
    name: { he: "אור הנר", en: "Or HaNer" },
    aliases: { he: [], en: ["Or Haner"] },
    selectable: true,
    cameraHint: {
      center: { lng: 34.6, lat: 31.5 },
      centerItm: { x: 165000, y: 595000 },
      zoom: 15,
    },
  },
  {
    id: "yeshuv-0069",
    name: { he: "בארי", en: "Be'eri" },
    aliases: { he: [], en: [] },
    selectable: true,
    cameraHint: {
      center: { lng: 34.49, lat: 31.42 },
      centerItm: { x: 164000, y: 594000 },
      zoom: 15,
    },
  },
];

describe("remote place navigation", () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

    document.querySelector(".place-suggestion").dispatchEvent({ type: "click" });
    expect(dataContext.navigateToPlace).toHaveBeenCalledWith(places[0]);
  });

  test("clear button resets input and list", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );

    initRemotePlaceNavigation({
      dataContext: { navigateToPlace: vi.fn() },
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
