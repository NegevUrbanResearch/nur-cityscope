import { placeNameField, nameRectangleFits } from './nli-name-field-layout.js';
import { resolveNliLocation } from './nli-name-field-places.js';
import { NLI_NAME_FIELD_SOURCE_UV } from './nli-name-field-calibration.js';
import { outputToT3, t3ToOutput } from './projection-config-geometry.js';
import { DEFAULT_PROJECTION_CONFIG } from './projection-config-schema.js';

const WIDTH = 1920;
const HEIGHT = 1080;
const RAD = Math.PI / 180;
const MEMORIAL_STATUSES = new Set(['Murdered', 'Killed on duty', 'Murdered in captivity']);
const mercator = ([lon, lat]) => [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2)) / Math.PI) / 2];
const lngLat = ([x, y]) => [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD];
const rotate = ([x, y], angle) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

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

function t3UvToPlane({ u, v }, { pre, planeScale, headingRad }) {
  const scaled = [(u - 0.5) * WIDTH / pre.scale, (v - 0.5) * HEIGHT / pre.scale];
  const translated = rotate(scaled, pre.rotateDeg * RAD);
  const base = [translated[0] - pre.tx * WIDTH, translated[1] - pre.ty * HEIGHT];
  const unheaded = rotate(base, -headingRad);
  return [unheaded[0] * planeScale, unheaded[1] * planeScale];
}

function planeToT3Uv([x, y], { pre, planeScale, headingRad }) {
  const headed = rotate([x / planeScale, y / planeScale], headingRad);
  const translated = [headed[0] + pre.tx * WIDTH, headed[1] + pre.ty * HEIGHT];
  const scaled = rotate(translated, -pre.rotateDeg * RAD);
  return { u: 0.5 + scaled[0] * pre.scale / WIDTH, v: 0.5 + scaled[1] * pre.scale / HEIGHT };
}

/** One common plane for both spans and GIS, in reference-projector pixels along the text heading. */
export function createNameFieldGeometry({ bounds, footprint, heading = 41, projectionConfig = DEFAULT_PROJECTION_CONFIG, sourceUv = NLI_NAME_FIELD_SOURCE_UV }) {
  const sw = mercator(bounds?.[0] || []), ne = mercator(bounds?.[1] || []);
  const dx = ne[0] - sw[0], dy = sw[1] - ne[1];
  if (![...sw, ...ne, heading].every(Number.isFinite) || dx <= 0 || dy <= 0) throw new Error('Invalid name field model bounds');
  const center = [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2];
  const baseScale = Math.min(WIDTH / dx, HEIGHT / dy);
  const postReferenceScale = Math.min(
    Number(projectionConfig.outputs.left.post.scale),
    Number(projectionConfig.outputs.right.post.scale),
  );
  const planeScale = Number(projectionConfig.pre.scale) * postReferenceScale;
  if (![postReferenceScale, planeScale].every(Number.isFinite) || postReferenceScale <= 0 || planeScale <= 0) throw new Error('Invalid projection config scales');
  const scale = baseScale * planeScale;
  const angle = heading * RAD;
  const project = (coordinates) => {
    const p = mercator(coordinates);
    return rotate([(p[0] - center[0]) * scale, (p[1] - center[1]) * scale], -angle);
  };
  const unproject = (position) => {
    const p = rotate(position, angle);
    return lngLat([center[0] + p[0] / scale, center[1] + p[1] / scale]);
  };
  const footprintPlane = footprint?.map(project);
  const spanPolygons = Object.fromEntries(['left', 'right'].map((span) => {
    const polygon = sourceUv[span].map(([u, v]) => t3UvToPlane(
      outputToT3({ u, v }, projectionConfig.outputs[span]),
      { pre: projectionConfig.pre, planeScale, headingRad: angle },
    ));
    return [span,footprintPlane ? clipPolygon(footprintPlane, polygon) : polygon];
  }).filter(([,p]) => p.length >= 3));
  const polygons=Object.values(spanPolygons);
  if (!polygons.length) throw new Error('Name field footprint is outside projection');
  const visibleSpansForRectangle = (rect) => {
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return [];
    const outputBySpan = Object.fromEntries(Object.keys(sourceUv).map((span) => {
      const t3 = planeToT3Uv([rect.x, rect.y], { pre: projectionConfig.pre, planeScale, headingRad: angle });
      return [span, t3ToOutput(t3, projectionConfig.outputs[span])];
    }));
    return Object.keys(sourceUv).filter((span) => {
      const output = outputBySpan[span];
      const branch = projectionConfig.outputs[span];
      const cropWidth = Number(branch.crop.x1) - Number(branch.crop.x0);
      const cropHeight = Number(branch.crop.y1) - Number(branch.crop.y0);
      const effectiveGain = Number(branch.post.scale) * Math.min(1 / cropWidth, 1 / cropHeight);
      const outputScale = effectiveGain / postReferenceScale;
      const pageRect = {
        x: output.u,
        y: output.v,
        width: (rect.width * outputScale + 4) / WIDTH,
        height: (rect.height * outputScale + 4) / HEIGHT,
      };
      return nameRectangleFits(pageRect, [sourceUv[span]]);
    });
  };
  return {
    project,
    unproject,
    polygons,
    spanPolygons,
    heading,
    visibleSpansForRectangle,
    referenceZoom: Math.log2(baseScale * planeScale / 512),
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
      verticalDistribution: 'full-height',
      candidateFits: rect => geometry.visibleSpansForRectangle(rect).length > 0,
    });
    if (!result.unplaced.length) break;
  }
  if (!result || result.unplaced.length) throw new Error(`Name field capacity: ${result?.unplaced.length ?? rows.length} names cannot fit`);
  const positions = new Map(result.placements.map(p=>[p.id,p]));
  const byPid = new Map();
  const geojson = {type:'FeatureCollection',features:rows.map(row=>{
    const pos = positions.get(row.id);
    const fitting = geometry.visibleSpansForRectangle(pos);
    const owner = fitting.includes('left') ? 'left' : fitting[0];
    if (!owner) throw new Error(`Name ${row.id} has no fully visible projector`);
    const visible_spans = [owner];
    const feature = {type:'Feature',id:row.id,properties:{pid:row.id,name:row.name,location:row.location,group_id:row.groupId,visible_spans},geometry:{type:'Point',coordinates:geometry.unproject([pos.x,pos.y])}};
    byPid.set(row.id,{feature,sourceCoordinates:row.sourceCoordinates.slice()});
    return feature;
  })};
  const groupGeojson={type:'FeatureCollection',features:[...grouped.values()].map(group=>({
    type:'Feature',properties:{group_id:group.id,name:group.label,place_ids:group.placeId?[group.placeId]:[],visible_spans:[]},
    geometry:{type:'Point',coordinates:group.sourceCoordinates.slice()}
  }))};
  return {geojson,groupGeojson,byPid,fontSize,heading:geometry.heading,referenceZoom:geometry.referenceZoom,overviewBounds:geometry.overviewBounds?.map((point) => point.slice()),datasetVersion,
    diagnostics:{total:rows.length,sourceTotal:data.features.length,excluded:data.features.length-rows.length,placed:rows.length,groups:grouped.size,unplaced:result.unplaced,fontSize,referenceZoom:geometry.referenceZoom}};
}
