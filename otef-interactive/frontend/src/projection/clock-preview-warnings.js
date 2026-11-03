import { mapOverlayOutline, mapSourceUvToOutput } from "../projection-config/clock-layout-geometry.js";
import { projectionOverlayMatrix } from "./projection-overlay-placement.js";
import { measureNliExplainerUnclampedHeight } from "./nli-explainer-overlay.js";

export function validClockPreviewWarnings(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && typeof value.clipped === "boolean" && typeof value.outOfView === "boolean"
    && ["complete", "partial", "unavailable"].includes(value.mapping)
    && Object.keys(value).every((key) => ["clipped", "outOfView", "mapping"].includes(key));
}

export function measureClockPreviewWarnings({ layout, mesh = null, surface, element, content = element, clock = false }) {
  const width = Number(element?.clientWidth) || 0;
  const height = Number(element?.clientHeight) || 0;
  const contentWidth = Math.max(Number(content?.scrollWidth) || 0, Number(content?.offsetWidth) || 0);
  const contentHeight = Math.max(Number(content?.scrollHeight) || 0, Number(content?.offsetHeight) || 0,
    clock ? measureNliExplainerUnclampedHeight(content) : 0);
  const clipped = (width > 0 && contentWidth > width + 1) || (height > 0 && contentHeight > height + 1);
  const matrix = projectionOverlayMatrix(layout);
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => ({
    u: matrix[0] * u + matrix[3] * v + matrix[6], v: matrix[1] * u + matrix[4] * v + matrix[7],
  }));
  const outside = (point) => point.x < -1e-7 || point.y < -1e-7 || point.x > 1 + 1e-7 || point.y > 1 + 1e-7;
  let outOfView = corners.some(({ u, v }) => outside({ x: u, y: v }));
  let mapping = "complete";
  if (surface === "projection") {
    const outline = mapOverlayOutline(mesh, layout);
    const perimeter = corners.reduce((sum, point, index) => {
      const next = corners[(index + 1) % 4]; return sum + Math.hypot(point.u - next.u, point.v - next.v);
    }, 0);
    const covered = outline.reduce((sum, edge) => sum + Math.hypot(edge.sourceEnd.u - edge.sourceStart.u, edge.sourceEnd.v - edge.sourceStart.v), 0);
    mapping = !outline.length ? "unavailable" : covered + 1e-7 < perimeter || corners.some((point) => !mapSourceUvToOutput(mesh, point)) ? "partial" : "complete";
    outOfView ||= outline.some((edge) => outside(edge.start) || outside(edge.end));
  }
  return { clipped, outOfView, mapping };
}
