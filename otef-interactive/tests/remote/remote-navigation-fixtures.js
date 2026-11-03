import { vi } from "vitest";

export function createElement(id = "") {
  const listeners = new Map();
  const children = [];
  return {
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
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    dispatchEvent(event) { (listeners.get(event.type) || []).forEach((handler) => handler(event)); },
    click() { this.dispatchEvent({ type: "click" }); },
    append(child) { child.parentNode = this; children.push(child); },
    replaceChildren(...nextChildren) {
      children.length = 0;
      nextChildren.forEach((child) => { child.parentNode = this; });
      children.push(...nextChildren);
    },
    querySelector(selector) {
      if (selector.startsWith("#")) return null;
      if (selector === ".place-suggestion") return children.find((child) => child.className === "place-suggestion") || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".place-suggestion") return children.filter((child) => child.className === "place-suggestion");
      return [];
    },
  };
}

let elements;
let documentListeners;

export function installDom() {
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
      documentListeners.set(type, handlers.filter((registered) => registered !== handler));
    },
    dispatchEvent(event) { (documentListeners.get(event.type) || []).forEach((handler) => handler(event)); },
    getElementById: (id) => elements[id] || null,
    createElement: () => { const element = createElement(); element.ownerDocument = documentStub; return element; },
    querySelector: (selector) => selector === ".place-suggestion"
      ? elements.placeSuggestions.children.find((child) => child.className === "place-suggestion") || null
      : null,
    querySelectorAll: (selector) => selector === ".place-suggestion"
      ? elements.placeSuggestions.children.filter((child) => child.className === "place-suggestion")
      : [],
  };
  Object.values(elements).forEach((element) => { element.ownerDocument = documentStub; });
  elements.placeSearchGroup.querySelector = (selector) => selector.startsWith("#") ? elements[selector.slice(1)] || null : null;
  elements.placeSearchGroup.querySelectorAll = () => [];
  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
}

export const places = [
  {
    id: "yeshuv-0067",
    name: { he: "אור הנר", en: "Or HaNer" },
    aliases: { he: [], en: ["Or Haner"] },
    selectable: true,
    cameraHint: { center: { lng: 34.6, lat: 31.5 }, centerItm: { x: 165000, y: 595000 }, zoom: 15 },
  },
  {
    id: "yeshuv-0069",
    name: { he: "בארי", en: "Be'eri" },
    aliases: { he: [], en: [] },
    selectable: true,
    cameraHint: { center: { lng: 34.49, lat: 31.42 }, centerItm: { x: 164000, y: 594000 }, zoom: 15 },
  },
];
