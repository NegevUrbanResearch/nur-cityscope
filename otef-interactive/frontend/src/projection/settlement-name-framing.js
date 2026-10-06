import { getProjectionSpanClipRect } from './projection-span-view.js';

const WIDTH = 1920, HEIGHT = 1080;
const mercator = (lng, lat) => [lng / 360 + 0.5, 0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI)];
const referenceError = () => new Error('Settlement label capture cannot provide a consistent calibration reference');

/** Pixel-space affine matrix, using the Canvas [a,b,c,d,e,f] convention. */
export function mapSettlementPosition(point, matrix, inverse = false) {
  if (!matrix) return { ...point };
  if (matrix.length !== 6 || !matrix.every(Number.isFinite)) return null;
  const [a,b,c,d,e,f] = matrix;
  if (!inverse) return { x: a*point.x+c*point.y+e, y: b*point.x+d*point.y+f };
  const determinant = a*d-b*c;
  if (Math.abs(determinant) < 1e-12) return null;
  return { x: (d*(point.x-e)-c*(point.y-f))/determinant, y: (-b*(point.x-e)+a*(point.y-f))/determinant };
}

function solve(matrix, values) {
  const size = values.length, rows = matrix.map((row, i) => [...row, values[i]]);
  for (let column=0; column<size; column+=1) {
    let pivot=column;
    for (let row=column+1; row<size; row+=1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot=row;
    if (Math.abs(rows[pivot][column]) < 1e-12) throw referenceError();
    [rows[column],rows[pivot]]=[rows[pivot],rows[column]];
    const divisor=rows[column][column]; rows[column]=rows[column].map(value=>value/divisor);
    for (let row=0; row<size; row+=1) if (row!==column) {
      const factor=rows[row][column]; rows[row]=rows[row].map((value,i)=>value-factor*rows[column][i]);
    }
  }
  return rows.map(row=>row[size]);
}

function recoverReference(catalog, baseline, output) {
  const samples = (catalog?.entries || []).flatMap(entry => {
    if (catalog.supplementalCodes?.has(entry.citycode)) return [];
    const position=baseline?.outputs?.[output]?.[entry.citycode];
    if (!position) return [];
    const world=mercator(entry.lng,entry.lat), offset=catalog.referenceOffsets?.get(entry.citycode) || [0,0];
    if (![...world,...offset,position.x,position.y].every(Number.isFinite)) throw referenceError();
    return [{ world,offset,position }];
  });
  if (samples.length < 3) throw referenceError();
  const center=[0,1].map(axis=>samples.reduce((sum,sample)=>sum+sample.world[axis],0)/samples.length);
  const varyingOffsets=samples.some(sample=>sample.offset.some((value,axis)=>value!==samples[0].offset[axis]));
  const size=varyingOffsets ? 5 : 3;
  if (samples.length < size) throw referenceError();
  // Source text offsets explain per-label displacements; exclude them from the camera transform.
  const rows=samples.map(sample=>[1,(sample.world[0]-center[0])*10000,(sample.world[1]-center[1])*10000,...(varyingOffsets ? sample.offset : [])]);
  const normal=Array.from({length:size},(_,i)=>Array.from({length:size},(_,j)=>rows.reduce((sum,row)=>sum+row[i]*row[j],0)));
  const coefficients=['x','y'].map(key=>solve(normal,Array.from({length:size},(_,i)=>rows.reduce((sum,row,j)=>sum+row[i]*samples[j].position[key],0))));
  const error=Math.max(...samples.map((sample,index)=>Math.hypot(...coefficients.map((coefficient,axis)=>coefficient.reduce((sum,value,i)=>sum+value*rows[index][i],0)-sample.position[axis===0?'x':'y']))));
  if (!Number.isFinite(error) || error > 0.25) throw referenceError();
  const [x,y]=coefficients;
  const camera=[x[1],y[1],x[2],y[2],x[0],y[0]];
  const reference = position=>{
    const relative=mapSettlementPosition(position,camera,true);
    if (!relative) throw referenceError();
    const u=center[0]+relative.x/10000, v=center[1]+relative.y/10000;
    return [(u-0.5)*360,Math.atan(Math.sinh((0.5-v)*2*Math.PI))*180/Math.PI];
  };
  reference.toReference = (lng, lat) => {
    const world = mercator(lng, lat);
    return mapSettlementPosition({ x: (world[0] - center[0]) * 10000, y: (world[1] - center[1]) * 10000 }, camera);
  };
  return reference;
}

/** Initialize a new name in the captured frame without changing existing anchors. */
export function captureSettlementReferencePosition({ catalog, baseline, output, lng, lat }) {
  return recoverReference(catalog, baseline, output).toReference(lng, lat);
}

/** Derive current map framing deterministically from the immutable captured label anchors. */
export function createSettlementNameFraming({ map, output, getConfig } = {}) {
  let cachedCatalog, cachedBaseline, reference;
  return ({ catalog, settings }) => {
    if (typeof map?.project !== 'function') return null;
    if (cachedCatalog!==catalog || cachedBaseline!==settings?.baseline) {
      const recovered=recoverReference(catalog,settings?.baseline,output);
      cachedCatalog=catalog; cachedBaseline=settings?.baseline; reference=recovered;
    }
    const container=map.getContainer?.();
    const width=Number(container?.clientWidth), height=Number(container?.clientHeight);
    if (!(width>0 && height>0)) throw referenceError();
    const project=position=>{ const p=map.project(reference(position)); return {x:p.x*WIDTH/width,y:p.y*HEIGHT/height}; };
    const origin=project({x:0,y:0}), across=project({x:WIDTH,y:0}), down=project({x:0,y:HEIGHT});
    const matrix=[(across.x-origin.x)/WIDTH,(across.y-origin.y)/WIDTH,(down.x-origin.x)/HEIGHT,(down.y-origin.y)/HEIGHT,origin.x,origin.y].map(value=>Math.round(value*1e9)/1e9);
    if (!matrix.every(Number.isFinite) || !mapSettlementPosition(origin,matrix,true)) throw referenceError();
    const clip=getProjectionSpanClipRect(getConfig?.(),output);
    return {matrix,clip:clip ? [clip.x0,clip.y0,clip.x1,clip.y1] : [0,0,0,0]};
  };
}
