/**
 * Normalized visit-order for pink detour Point features (GIS + projection labels).
 * Accepts numeric strings so API/GeoJSON parity matches Colab-style integers.
 *
 * @param {Record<string, unknown> | null | undefined} props
 * @returns {number | null}
 */
export function readPinkNodeOrder(props) {
  const o = props && props.pink_node_order;
  if (typeof o === "number" && Number.isFinite(o)) return o;
  if (typeof o === "string" && String(o).trim() !== "") {
    const n = Number(o);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
