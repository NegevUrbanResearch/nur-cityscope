import { placeNameField, nameRectangleFits } from './nli-name-field-layout.js';
import { resolveNliLocation } from './nli-name-field-places.js';
import MapProjectionConfig from './map-projection-config.js';
import { NLI_NAME_FIELD_SOURCE_UV } from './nli-name-field-calibration.js';
import { outputToT3, t3ToOutput, visibleT3Rect } from './projection-config-geometry.js';
import { DEFAULT_PROJECTION_CONFIG } from './projection-config-schema.js';

const WIDTH = 1920;
const HEIGHT = 1080;
const RAD = Math.PI / 180;
const MEMORIAL_STATUSES = new Set(['Murdered', 'Killed on duty', 'Murdered in captivity']);
const mercator = ([lon, lat]) => [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2)) / Math.PI) / 2];
const lngLat = ([x, y]) => [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD];
const rotate = ([x, y], angle) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

/** Choose one projector for a complete label. Equal clearances intentionally go left. */
export function chooseProjectionNameOwner(leftClearance, rightClearance) {
  if (leftClearance < 0 && rightClearance < 0) return null;
  if (leftClearance >= 0 && leftClearance >= rightClearance) return 'left';
  return 'right';
}

function rectangleEntries(labelRectangles, field) {
  const source = labelRectangles ?? field?.labelRectangles ?? field?.placements;
  if (source instanceof Map) return [...source.entries()].map(([pid, rect]) => ({ pid: String(pid), rect }));
  if (Array.isArray(source)) return source.map((rect) => ({ pid: String(rect?.pid ?? rect?.id ?? ''), rect }));
  if (source && typeof source === 'object') {
    return Object.entries(source).map(([pid, rect]) => ({ pid: String(pid), rect }));
  }
  if (field?.byPid instanceof Map) {
    return [...field.byPid.entries()].map(([pid, value]) => ({
      pid: String(pid),
      rect: value?.labelRectangle ?? value?.rectangle ?? value?.labelRect,
    }));
  }
  return [];
}

function labelRectangle(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const hasCenter = rect.x !== undefined || rect.y !== undefined;
  let x = Number(rect.x ?? rect.left ?? rect.x0);
  let y = Number(rect.y ?? rect.top ?? rect.y0);
  let width = Number(rect.width ?? (Number(rect.x1) - x));
  let height = Number(rect.height ?? (Number(rect.y1) - y));
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const coordinateSpace = rect.coordinateSpace === 'plane' ? 'plane' : 't3';
  const normalized = coordinateSpace !== 'plane' && (rect.coordinateSpace === 'normalized' ||
    (rect.coordinateSpace !== 'pixels' && Math.max(Math.abs(x), Math.abs(y), Math.abs(width), Math.abs(height)) <= 1.000000001));
  if (coordinateSpace === 't3' && !normalized) {
    x /= WIDTH;
    y /= HEIGHT;
    width /= WIDTH;
    height /= HEIGHT;
  }
  return {
    x,
    y,
    width,
    height,
    coordinateSpace,
    anchor: rect.anchor || (hasCenter ? 'center' : rect.x0 !== undefined ? 'edges' : 'top-left'),
  };
}

function corners(rect) {
  const x = rect.anchor === 'top-left' ? rect.x + rect.width / 2 : rect.anchor === 'edges' ? rect.x + rect.width / 2 : rect.x;
  const y = rect.anchor === 'top-left' ? rect.y + rect.height / 2 : rect.anchor === 'edges' ? rect.y + rect.height / 2 : rect.y;
  return [
    [x - rect.width / 2, y - rect.height / 2],
    [x + rect.width / 2, y - rect.height / 2],
    [x + rect.width / 2, y + rect.height / 2],
    [x - rect.width / 2, y + rect.height / 2],
  ];
}

function configBranchCorners(rect, branch, config, projection) {
  if (!rect || !branch?.crop || !branch?.post) return null;
  const sourceCorners = corners(rect);
  if (rect.coordinateSpace === 't3') {
    const t3Corners = sourceCorners.map(([x, y]) => ({ u: x, v: y }));
    return { t3Corners, outputCorners: t3Corners.map((point) => t3ToOutput(point, branch)), visible: visibleT3Rect(branch), branch };
  }
  if (!projection) return null;
  const pre = config?.pre;
  const planeScale = Number(projection.planeScale);
  const heading = Number(projection.headingRad);
  if (!pre || !Number.isFinite(planeScale) || planeScale <= 0 || !Number.isFinite(heading)) return null;
  const preScale = Number(pre.scale);
  const bearing = Number(pre.rotateDeg) * RAD;
  if (![preScale, bearing, Number(pre.tx), Number(pre.ty)].every(Number.isFinite) || preScale <= 0) return null;
  const t3Corners = sourceCorners.map(([x, y]) => {
    const base = rotate([x / planeScale, y / planeScale], heading);
    const rotated = rotate([base[0] + Number(pre.tx) * WIDTH, base[1] + Number(pre.ty) * HEIGHT], -bearing);
    return { u: 0.5 + (preScale * rotated[0]) / WIDTH, v: 0.5 + (preScale * rotated[1]) / HEIGHT };
  });
  return { t3Corners, outputCorners: t3Corners.map((point) => t3ToOutput(point, branch)), visible: visibleT3Rect(branch), branch };
}

function outputRectangleClearance(mapped) {
  const rectangle = mapped?.outputCorners;
  const visible = mapped?.visible;
  if (!Array.isArray(rectangle) || rectangle.length !== 4 || !rectangle.every((point) => point && Number.isFinite(point.u) && Number.isFinite(point.v))) return -Infinity;
  if (!visible || !mapped.t3Corners.every(({ u, v }) => u >= visible.x0 - 1e-9 && u <= visible.x1 + 1e-9 && v >= visible.y0 - 1e-9 && v <= visible.y1 + 1e-9)) return -Infinity;
  // Ownership is evaluated in one canonical 16:9 reference geometry for
  // both eyes, so the selected halo uses fixed reference pixels as well.
  const haloX = 2 / WIDTH;
  const haloY = 2 / HEIGHT;
  const x0 = Math.min(...rectangle.map(({ u }) => u)) - haloX;
  const x1 = Math.max(...rectangle.map(({ u }) => u)) + haloX;
  const y0 = Math.min(...rectangle.map(({ v }) => v)) - haloY;
  const y1 = Math.max(...rectangle.map(({ v }) => v)) + haloY;
  const visibleOutput = [
    [visible.x0, visible.y0],
    [visible.x1, visible.y0],
    [visible.x1, visible.y1],
    [visible.x0, visible.y1],
  ].map(([u, v]) => mapped.branch ? t3ToOutput({ u, v }, mapped.branch) : null);
  const clipX0 = visibleOutput.every(Boolean) ? Math.max(0, Math.min(...visibleOutput.map(({ u }) => u))) : 0;
  const clipX1 = visibleOutput.every(Boolean) ? Math.min(1, Math.max(...visibleOutput.map(({ u }) => u))) : 1;
  const clipY0 = visibleOutput.every(Boolean) ? Math.max(0, Math.min(...visibleOutput.map(({ v }) => v))) : 0;
  const clipY1 = visibleOutput.every(Boolean) ? Math.min(1, Math.max(...visibleOutput.map(({ v }) => v))) : 1;
  return Math.min(
    x0 - clipX0,
    clipX1 - x1,
    y0 - clipY0,
    clipY1 - y1,
  );
}

/**
 * Derive final app-visible ownership from prepared label rectangles.
 * `owners` is keyed by stable PID; prepared feature visibility is never edited.
 */
export function computeProjectionNameOwnership({ field, config, labelRectangles } = {}) {
  const effectiveConfig = config || DEFAULT_PROJECTION_CONFIG;
  const outputs = effectiveConfig.outputs;
  const projection = field?.projection;
  const owners = {};
  let clippedCount = 0;
  for (const { pid, rect: rawRect } of rectangleEntries(labelRectangles, field)) {
    if (!pid) continue;
    const rect = labelRectangle(rawRect);
    const owner = chooseProjectionNameOwner(
      outputRectangleClearance(configBranchCorners(rect, outputs?.left, effectiveConfig, projection)),
      outputRectangleClearance(configBranchCorners(rect, outputs?.right, effectiveConfig, projection)),
    );
    if (owner) owners[pid] = owner;
    else clippedCount += 1;
  }
  // Keep object serialization convenient for GeoJSON while offering the Map
  // lookup shape used by existing field metadata consumers.
  Object.defineProperties(owners, {
    get: { value: (pid) => owners[String(pid)], enumerable: false },
    has: { value: (pid) => Object.hasOwn(owners, String(pid)), enumerable: false },
    size: { get: () => Object.keys(owners).length, enumerable: false },
  });
  return { owners, clippedCount };
}

/** Clip a geographic footprint to one convex viewport; preserve concave subject edges. */
function clipPolygon(subject, clip) {
  let result = subject;
  const area = clip.reduce((sum, a, i) => { const b = clip[(i + 1) % clip.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0);
  const sign = Math.sign(area);
  for (let i = 0; i < clip.length && result.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = result; result = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const cp = sign * cross(a, b, p), cq = sign * cross(a, b, q);
      if (cp >= 0) result.push(p);
      if ((cp >= 0) !== (cq >= 0)) {
        const t = cp / (cp - cq);
        result.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return result;
}

/** One common plane for both spans and GIS, in reference-projector pixels along the text heading. */
export function createNameFieldGeometry({ bounds, footprint, heading = 41, spanConfig = MapProjectionConfig.PROJECTION_SPAN, sourceUv = NLI_NAME_FIELD_SOURCE_UV }) {
  const sw = mercator(bounds?.[0] || []), ne = mercator(bounds?.[1] || []);
  const dx = ne[0] - sw[0], dy = sw[1] - ne[1];
  if (![...sw, ...ne, heading].every(Number.isFinite) || dx <= 0 || dy <= 0) throw new Error('Invalid name field model bounds');
  const center = [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2];
  const baseScale = Math.min(WIDTH / dx, HEIGHT / dy);
  const preScale = baseScale * spanConfig.PRE_SCALE;
  const scale = preScale * spanConfig.POST_SCALE;
  const angle = heading * RAD;
  const project = (coordinates) => {
    const p = mercator(coordinates);
    return rotate([(p[0] - center[0]) * scale, (p[1] - center[1]) * scale], -angle);
  };
  const unproject = (position) => {
    const p = rotate(position, angle);
    return lngLat([center[0] + p[0] / scale, center[1] + p[1] / scale]);
  };
  // Mirrors fitBounds(bearing 0), then computeTesugaPreT3JumpTo and post-fill camera.
  const preCenter = [center[0] - spanConfig.PRE_TX * WIDTH / baseScale, center[1] - spanConfig.PRE_TY * HEIGHT / baseScale];
  const bearing = spanConfig.PRE_ROTATE_DEG * RAD;
  const footprintPlane = footprint?.map(project);
  const spanPolygons = Object.fromEntries([
    ['left',spanConfig.LEFT_X0, spanConfig.LEFT_X1],
    ['right',spanConfig.RIGHT_X0, spanConfig.RIGHT_X1],
  ].map(([span,x0, x1]) => {
    const visibleX = (x0 + x1) / 2;
    const visibleY = 0.5 - spanConfig.POST_TY / spanConfig.POST_SCALE;
    const offset = rotate([(visibleX - 0.5) * WIDTH / preScale, (visibleY - 0.5) * HEIGHT / preScale], bearing);
    const camera = [preCenter[0] + offset[0], preCenter[1] + offset[1]];
    const polygon = sourceUv[span].map(([u,v]) => {
      const x=u*WIDTH,y=v*HEIGHT;
      const local = rotate([(x-WIDTH/2)/scale,(y-HEIGHT/2)/scale],bearing);
      return rotate([(camera[0]+local[0]-center[0])*scale,(camera[1]+local[1]-center[1])*scale],-angle);
    });
    return [span,footprintPlane ? clipPolygon(footprintPlane, polygon) : polygon];
  }).filter(([,p]) => p.length >= 3));
  const polygons=Object.values(spanPolygons);
  if (!polygons.length) throw new Error('Name field footprint is outside projection');
  return {
    project,
    unproject,
    polygons,
    spanPolygons,
    heading,
    // Metadata lets calibration map centered heading-plane placements through
    // a new effective pre transform without changing those placements.
    projection: { baseScale, planeScale: scale / baseScale, headingRad: angle },
    referenceZoom: Math.log2(scale / 512),
    overviewBounds: bounds.map((point) => point.slice()),
  };
}

export function buildNliNameField(data, geometry, { measureText = (text, size) => text.length * size * 0.65, fontSizes = [12,10,8], datasetVersion = '' } = {}) {
  if (!Array.isArray(data?.features) || !data.features.length) throw new Error('Missing name field features');
  const ids = new Set();
  const included = data.features.filter(feature => MEMORIAL_STATUSES.has(feature.properties?.status));
  if (!included.length) throw new Error('No people killed in the name field dataset');
  const rows = included.map(feature => {
    const p = feature.properties || {};
    const id = String(p.pid ?? feature.id ?? '').trim();
    if (!id || ids.has(id)) throw new Error(`Missing or duplicate name field PID: ${id}`);
    ids.add(id);
    const name = String(p.hebrew_name || p.name || '').trim();
    if (!name) throw new Error(`Missing name for PID ${id}`);
    // Hebrew name order is not derivable from Latin fields: the source mixes
    // given-first, surname-first, middle names, and compound surnames. Use an
    // explicit Hebrew sort key only when supplied; otherwise preserve the
    // displayed Hebrew string as the provisional alphabetical key.
    const orderKey = String(p.sort_name_he || name).trim();
    const recorded = [p.source_lon, p.source_lat];
    const sourceCoordinates = recorded.every(v => typeof v === 'number' && Number.isFinite(v)) ? recorded : feature.geometry?.coordinates?.slice(0,2);
    if (feature.geometry?.type !== 'Point' || sourceCoordinates?.length !== 2 || !sourceCoordinates.every(Number.isFinite)) throw new Error(`Invalid location for PID ${id}`);
    const [x,y] = geometry.project(sourceCoordinates);
    return {id,name,orderKey,location:p.location || '',place:resolveNliLocation(p.location),x,y,sourceCoordinates};
  });
  const grouped=new Map();
  for(const row of rows){
    const key=row.place.groupId || `unknown-${row.id}`;
    row.groupId=key;
    if(!grouped.has(key))grouped.set(key,{...row.place,id:key,rows:[]});
    grouped.get(key).rows.push(row);
  }
  for(const group of grouped.values()){
    const middle=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
    group.sourceCoordinates=group.anchorCoordinates || [middle(group.rows.map(r=>r.sourceCoordinates[0])),middle(group.rows.map(r=>r.sourceCoordinates[1]))];
  }
  let result, fontSize;
  for (fontSize of fontSizes) {
    const items = rows.map(r => ({id:r.id,x:r.x,y:r.y,width:Math.ceil(measureText(r.name,fontSize)*1.12+6),height:fontSize*1.5+2}));
    result = placeNameField(rows.map((row, index) => ({
      ...items[index], orderKey: row.orderKey,
    })), { polygons: geometry.polygons, gap: 2, step: 4, orderBy: 'orderKey', readingOrder: 'rtl',
      // Reject edge slivers narrower than three typical labels so the field
      // begins as a readable row, rather than isolated names at the boundary.
      minRowWidth: items.map(item => item.width).sort((a, b) => a - b)[Math.floor(items.length / 2)] * Math.min(3, items.length),
    });
    if (!result.unplaced.length) break;
  }
  if (!result || result.unplaced.length) throw new Error(`Name field capacity: ${result?.unplaced.length ?? rows.length} names cannot fit`);
  const positions = new Map(result.placements.map(p=>[p.id,p]));
  const byPid = new Map();
  const labelRectangles = new Map();
  const geojson = {type:'FeatureCollection',features:rows.map(row=>{
    const pos = positions.get(row.id);
    const visible_spans=Object.entries(geometry.spanPolygons || {}).filter(([,polygon])=>nameRectangleFits(pos,[polygon])).map(([span])=>span);
    if (geometry.spanPolygons && !visible_spans.length) throw new Error(`Name ${row.id} has no fully visible projector`);
    const feature = {type:'Feature',id:row.id,properties:{pid:row.id,name:row.name,location:row.location,group_id:row.groupId,visible_spans},geometry:{type:'Point',coordinates:geometry.unproject([pos.x,pos.y])}};
    // Store the prepared rectangle once in canonical 16:9 placement pixels.
    // Projection calibration consumes this metadata without re-running packing.
    const labelRectangle = { x: pos.x, y: pos.y, width: pos.width, height: pos.height, coordinateSpace: 'plane' };
    labelRectangles.set(row.id, labelRectangle);
    byPid.set(row.id,{feature,sourceCoordinates:row.sourceCoordinates.slice(),labelRectangle});
    return feature;
  })};
  const groupGeojson={type:'FeatureCollection',features:[...grouped.values()].map(group=>({
    type:'Feature',properties:{group_id:group.id,name:group.label,place_ids:group.placeId?[group.placeId]:[],visible_spans:[]},
    geometry:{type:'Point',coordinates:group.sourceCoordinates.slice()}
  }))};
  return {geojson,groupGeojson,byPid,labelRectangles,fontSize,heading:geometry.heading,projection:geometry.projection,referenceZoom:geometry.referenceZoom,overviewBounds:geometry.overviewBounds?.map((point) => point.slice()),datasetVersion,
    diagnostics:{total:rows.length,sourceTotal:data.features.length,excluded:data.features.length-rows.length,placed:rows.length,groups:grouped.size,unplaced:result.unplaced,fontSize,referenceZoom:geometry.referenceZoom}};
}
