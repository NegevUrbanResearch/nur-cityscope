import { expect, test } from "vitest";
import { renderQr } from "../../frontend/src/shared/qr-code.js";

function svgDocument() {
  const document = {
    createElementNS: (_namespace, name) => {
      const node = {
        nodeName: name,
        children: [],
        attributes: {},
        setAttribute(key, value) { this.attributes[key] = String(value); },
        appendChild(child) { this.children.push(child); return child; },
      };
      return node;
    },
  };
  const host = {
    ownerDocument: document,
    children: [],
    replaceChildren(...children) { this.children = children; },
  };
  return host;
}

test("renderQr creates a local SVG with a quiet zone and selectable payload", () => {
  const host = svgDocument();
  const svg = renderQr(host, "https://example.test/remote-controller.html");
  expect(svg.nodeName).toBe("svg");
  expect(svg.attributes.viewBox).toMatch(/^0 0 /);
  expect(svg.attributes.width).toBe("256");
  expect(svg.attributes.height).toBe("256");
  expect(svg.children.some((child) => child.attributes.x === "4")).toBe(true);
  expect(host.children).toEqual([svg]);
});
