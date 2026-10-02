import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { createSettlementNameControls } from "../../frontend/src/projection-config/settlement-name-controls.js";

const catalog = { entries: [{ citycode: "0067", text: "נירים", lng: 34.4, lat: 31.3 }, { citycode: "0424", text: "מחוץ", lng: 34.2, lat: 31.2 }] };

function documentHarness() {
  const doc = {
    activeElement: null,
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(), children: [], dataset: {}, style: {}, hidden: false, value: "", disabled: false, className: "",
        append(...children) { children.forEach((child) => this.appendChild(child)); },
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        setAttribute(key, value) { this.attributes = { ...this.attributes, [key]: value }; },
        removeAttribute() {},
        addEventListener(type, handler) { (this.listeners ||= {})[type] = [...(this.listeners[type] || []), handler]; },
        dispatch(type) { for (const handler of this.listeners?.[type] || []) handler({ stopPropagation() {}, target: this, currentTarget: this }); },
      };
      node.ownerDocument = doc;
      return node;
    },
  };
  return doc;
}

function find(root, predicate) {
  const nodes = [root, ...(root.children || []).flatMap(function walk(node) { return [node, ...(node.children || []).flatMap(walk)]; })];
  return nodes.find(predicate);
}

test("numeric clearing is rejected and a replacement commits the new finite center", () => {
  const onPosition = vi.fn();
  const controls = createSettlementNameControls(documentHarness(), { catalog, onPosition, onStyle: vi.fn(), onOutput: vi.fn(), onCitycode: vi.fn() });
  controls.render({ output: "left", citycode: "0067", catalog, position: { x: 510, y: 350 }, style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 }, enabled: true, positionRecord: { status: "Saved" }, styleRecord: { status: "Saved" }, hydration: { status: "Saved" } });
  const x = find(controls.element, (node) => node.dataset?.field === "x");
  x.value = "";
  x.dispatch("change");
  expect(onPosition).not.toHaveBeenCalled();
  x.value = "true";
  x.dispatch("change");
  expect(onPosition).not.toHaveBeenCalled();
  x.value = "640";
  x.dispatch("change");
  expect(onPosition).toHaveBeenCalledWith({ x: 640, y: 350 });
});

test("shared style controls explain both projectors and reject an out-of-range font", () => {
  const onStyle = vi.fn();
  const controls = createSettlementNameControls(documentHarness(), { catalog, onPosition: vi.fn(), onStyle, onOutput: vi.fn(), onCitycode: vi.fn() });
  controls.render({ output: "right", citycode: "0067", catalog, position: { x: 1, y: 2 }, style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 }, enabled: true, positionRecord: { status: "Saved" }, styleRecord: { status: "Conflict" }, hydration: { status: "Saved" } });
  const note = find(controls.element, (node) => node.className === "settlement-shared-note");
  expect(note.textContent).toMatch(/both projectors/i);
  expect(note.textContent).toMatch(/save automatically/i);
  expect(note.textContent).toMatch(/Live and Apply/i);
  const font = find(controls.element, (node) => node.dataset?.field === "fontPx");
  font.value = "7";
  font.dispatch("change");
  expect(onStyle).not.toHaveBeenCalled();
  font.value = "24";
  font.dispatch("change");
  expect(onStyle).toHaveBeenCalledWith(expect.objectContaining({ fontPx: 24, rotateDeg: 35 }));
  expect(find(controls.element, (node) => node.className === "settlement-name-status").textContent).toBe("Changed on another screen");
});

test("settlement controls and the compact selector keep a 44px touch size", () => {
  const css = readFileSync(new URL("../../frontend/src/projection-config/config.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.settlement-name-dialog :is\(button, input, select\)[\s\S]*min-height:\s*44px/);
  expect(css).toMatch(/orientation:\s*portrait/);
  expect(css).toMatch(/@media \(max-width:\s*760px\)/);
  expect(css).toMatch(/\.node-selector\s*\{\s*display:\s*block/);
  expect(css).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
});
