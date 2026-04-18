/**
 * Colab-aligned greedy insertion visit order for pink detour nodes
 * (port of nur-colab-map `routeOptimizer.ts` — Euclidean lng/lat deltas).
 */

/**
 * @param {{ id: string, lat: number, lng: number }} node1
 * @param {{ id: string, lat: number, lng: number }} node2
 * @returns {number}
 */
function euclideanDistance(node1, node2) {
  const dx = node1.lng - node2.lng;
  const dy = node1.lat - node2.lat;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * @param {{ id: string, lat: number, lng: number }[]} nodes
 * @returns {{ id: string, lat: number, lng: number }[]}
 */
function insertionHeuristic(nodes) {
  if (nodes.length <= 2) return nodes;

  const unvisited = [...nodes];
  const route = [];

  const first = unvisited.shift();
  const second = unvisited.shift();
  route.push(first, second);

  while (unvisited.length > 0) {
    const newNode = unvisited.shift();
    let bestInsertionIndex = route.length;
    let minAddedDistance = Infinity;

    for (let i = 0; i < route.length - 1; i++) {
      const current = route[i];
      const next = route[i + 1];

      const originalDistance = euclideanDistance(current, next);
      const newDistance =
        euclideanDistance(current, newNode) + euclideanDistance(newNode, next);
      const addedDistance = newDistance - originalDistance;

      if (addedDistance < minAddedDistance) {
        minAddedDistance = addedDistance;
        bestInsertionIndex = i + 1;
      }
    }

    const insertAtStartDistance = euclideanDistance(newNode, route[0]);
    if (insertAtStartDistance < minAddedDistance) {
      minAddedDistance = insertAtStartDistance;
      bestInsertionIndex = 0;
    }

    const insertAtEndDistance = euclideanDistance(route[route.length - 1], newNode);
    if (insertAtEndDistance < minAddedDistance) {
      minAddedDistance = insertAtEndDistance;
      bestInsertionIndex = route.length;
    }

    route.splice(bestInsertionIndex, 0, newNode);
  }

  return route;
}

/**
 * @param {{ id: string, lat: number, lng: number }[]} nodes
 * @returns {{ id: string, lat: number, lng: number }[]}
 */
export function optimizePinkNodeVisitOrder(nodes) {
  if (!nodes || nodes.length <= 2) return nodes ? [...nodes] : [];
  return insertionHeuristic([...nodes]);
}

/**
 * Memorial `feature_type` values must not contribute to pink detour ordering
 * (mirrors `curated-layer-service` `isPinkDetourPointFeatureType`).
 *
 * @param {unknown} featureType
 * @returns {boolean}
 */
function isPinkDetourPointFeatureType(featureType) {
  if (featureType === null || featureType === undefined) return true;
  if (typeof featureType !== "string") return false;
  const normalized = featureType.trim().toLowerCase();
  if (normalized === "central" || normalized === "local") return false;
  if (normalized === "") return true;
  return normalized === "pink_line_node";
}

/**
 * Sets integer `properties.pink_node_order` (1-based) on pink detour Point features.
 *
 * @param {object[]} features - GeoJSON Feature array (mutated in place)
 */
export function assignPinkNodeDisplayOrders(features) {
  if (!Array.isArray(features)) return;

  const detourEntries = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (!f || f.type !== "Feature" || !f.geometry || f.geometry.type !== "Point") continue;
    const props = f.properties || {};
    if (!isPinkDetourPointFeatureType(props.feature_type)) continue;
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    detourEntries.push({
      feature: f,
      node: { id: `__pink_detour:${i}`, lat, lng },
    });
  }

  const ordered = optimizePinkNodeVisitOrder(detourEntries.map((e) => e.node));
  const orderBySynthId = new Map();
  ordered.forEach((n, idx) => {
    orderBySynthId.set(n.id, idx + 1);
  });

  for (const { feature, node } of detourEntries) {
    const ord = orderBySynthId.get(node.id);
    if (ord == null) continue;
    if (!feature.properties) feature.properties = {};
    feature.properties.pink_node_order = ord;
  }
}
