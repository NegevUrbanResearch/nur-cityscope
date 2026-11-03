import { qrcodegen } from "../../vendor/qrcodegen.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export function renderQr(host, text, { size = 256, quietZone = 4 } = {}) {
  if (!host || typeof text !== "string" || !text) throw new TypeError("QR host and text are required");
  const document = host.ownerDocument || globalThis.document;
  if (!document?.createElementNS) throw new Error("SVG is unavailable");
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const moduleCount = qr.size;
  const total = moduleCount + quietZone * 2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `0 0 ${total} ${total}`);
  svg.setAttribute("width", String(Math.max(240, size)));
  svg.setAttribute("height", String(Math.max(240, size)));
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code");
  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("width", String(total));
  background.setAttribute("height", String(total));
  background.setAttribute("fill", "#fff");
  svg.appendChild(background);
  for (let y = 0; y < moduleCount; y += 1) {
    for (let x = 0; x < moduleCount; x += 1) {
      if (!qr.getModule(x, y)) continue;
      const cell = document.createElementNS(SVG_NS, "rect");
      cell.setAttribute("x", String(x + quietZone));
      cell.setAttribute("y", String(y + quietZone));
      cell.setAttribute("width", "1");
      cell.setAttribute("height", "1");
      cell.setAttribute("fill", "#000");
      svg.appendChild(cell);
    }
  }
  if (typeof host.replaceChildren === "function") host.replaceChildren(svg);
  else host.appendChild?.(svg);
  return svg;
}
