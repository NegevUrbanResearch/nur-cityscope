import { createBaselineSampler, fingerprintBaselineMesh } from './projection-baseline-sampler.js';
import { assertRelativeTriangle } from './projection-relative-mesh.js';

const CAP = 65536;
const MAX_DEPTH = 12;
const TOLERANCE = 0.45;
const EPS = Number.EPSILON;
const finalMeshCache = new WeakMap();
const initialTopologyCache = new WeakMap();
const cross = (a, b, c, key1 = 's', key2 = 't') => (b[key1] - a[key1]) * (c[key2] - a[key2]) - (b[key2] - a[key2]) * (c[key1] - a[key1]);

function clip(poly, key, bound, greater) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const av = a[key] - bound; const bv = b[key] - bound;
    const ai = greater ? av >= -1e-14 : av <= 1e-14;
    const bi = greater ? bv >= -1e-14 : bv <= 1e-14;
    if (ai) out.push(a);
    if (ai !== bi) {
      const f = (bound - a[key]) / (b[key] - a[key]);
      const p = Object.fromEntries(['s','t','x','y','u','v'].map((name) => [name, a[name] + (b[name] - a[name]) * f]));
      p[key] = bound; out.push(p);
    }
  }
  return out.filter((p, i) => i === 0 || Math.hypot(p.s - out[i - 1].s, p.t - out[i - 1].t) > 1e-14);
}

function homography(corners) {
  const src = [[0,0],[1,0],[0,1],[1,1]], m=[], z=[];
  src.forEach(([x,y],i) => { const [u,v]=corners[i]; m.push([x,y,1,0,0,0,-x*u,-y*u]); z.push(u); m.push([0,0,0,x,y,1,-x*v,-y*v]); z.push(v); });
  const a=m.map((r,i)=>[...r,z[i]]);
  for(let c=0;c<8;c++){let p=c; for(let r=c+1;r<8;r++) if(Math.abs(a[r][c])>Math.abs(a[p][c]))p=r; if(Math.abs(a[p][c])<1e-9)throw Error('keystone corners produce a singular homography'); [a[c],a[p]]=[a[p],a[c]]; for(let r=c+1;r<8;r++){const q=a[r][c]/a[c][c];for(let k=c;k<9;k++)a[r][k]-=q*a[c][k];}}
  const h=Array(8).fill(0);for(let r=7;r>=0;r--){let q=a[r][8];for(let c=r+1;c<8;c++)q-=a[r][c]*h[c];h[r]=q/a[r][r];}return [...h,1];
}

function exact(point, triId, sample, h, grid, knownBaseline = null) {
  const b=knownBaseline||sample(point.s,point.t,triId); const d=h[6]*b.x+h[7]*b.y+h[8];
  if(!Number.isFinite(d)||Math.abs(d)<=1e-9) throw Error('keystone projective denominator is invalid');
  const locate=(axis,p)=>{let lo=0,hi=axis.length-1;while(lo+1<hi){const mid=(lo+hi)>>>1;if(axis[mid]<=p)lo=mid;else hi=mid;}if(p===1)lo=axis.length-2;return [lo,(p-axis[lo])/(axis[lo+1]-axis[lo])];};
  const [i,a]=locate(grid.columnPositions,point.s),[j,fy]=locate(grid.rowPositions,point.t),cols=grid.columns;
  const at=(x,y)=>grid.offsets[y*cols+x];const p00=at(i,j),p10=at(i+1,j),p01=at(i,j+1),p11=at(i+1,j+1);
  const r=[0,1].map(k=>((1-a)*p00[k]+a*p10[k])*(1-fy)+((1-a)*p01[k]+a*p11[k])*fy);
  const x=(h[0]*b.x+h[1]*b.y+h[2])/d+r[0], y=(h[3]*b.x+h[4]*b.y+h[5])/d+r[1];
  if(!Number.isFinite(x+y)||x < -1||x>2||y < -1||y>2)throw Error('warped point is outside safe extent [-1, 2]');
  return {...b,baseX:b.x,baseY:b.y,x,y};
}

function relativePositive(a,b,c,source) {
  assertRelativeTriangle(a,b,c,{sourceError:'source grid is numerically degenerate',destinationError:source ? 'source grid is numerically degenerate' : 'grid warp folds or collapses a triangle'});
}

function sourceWeights(a, b, c, s, t) {
  const denominator = cross(a, b, c);
  let wb = cross(a, { s, t }, c) / denominator;
  let wc = cross(a, b, { s, t }) / denominator;
  let wa = 1 - wb - wc;
  if ([wa, wb, wc].some((weight) => weight < -1e-12 || weight > 1 + 1e-12)) return null;
  const snapped = [wa, wb, wc].map((weight) => Math.abs(weight) <= 1e-12 ? 0 : Math.abs(weight - 1) <= 1e-12 ? 1 : weight);
  const total = snapped[0] + snapped[1] + snapped[2];
  return [snapped[0] / total, snapped[1] / total, snapped[2] / total];
}

function expandedFaceBins(vertices, faces) {
  const bins = Array.from({ length: 4096 }, () => []);
  faces.forEach((face, faceId) => {
    const points = face.v.map((id) => vertices[id]);
    const minS = Math.min(...points.map((point) => point.s));
    const maxS = Math.max(...points.map((point) => point.s));
    const minT = Math.min(...points.map((point) => point.t));
    const maxT = Math.max(...points.map((point) => point.t));
    const toleranceS = 2e-12 * Math.max(1, maxS - minS);
    const toleranceT = 2e-12 * Math.max(1, maxT - minT);
    const x0 = Math.max(0, Math.floor((minS - toleranceS) * 64));
    const x1 = Math.min(63, Math.floor((maxS + toleranceS) * 64));
    const y0 = Math.max(0, Math.floor((minT - toleranceT) * 64));
    const y1 = Math.min(63, Math.floor((maxT + toleranceT) * 64));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) bins[y * 64 + x].push(faceId);
  });
  return bins;
}

function globalSourceSamples(axesX, axesY) {
  const points = [];
  for (let y = 0; y <= 32; y += 1) for (let x = 0; x <= 32; x += 1) points.push([x / 32, y / 32]);
  for (const t of axesY) for (const s of axesX) points.push([s, t]);
  for (let row = 0; row < axesY.length - 1; row += 1) for (let column = 0; column < axesX.length - 1; column += 1) {
    const x0 = axesX[column], x1 = axesX[column + 1], y0 = axesY[row], y1 = axesY[row + 1];
    points.push([(x0 + x1) / 2, (y0 + y1) / 2], [(3 * x0 + x1) / 4, (3 * y0 + y1) / 4], [(x0 + 3 * x1) / 4, (3 * y0 + y1) / 4], [(3 * x0 + x1) / 4, (y0 + 3 * y1) / 4], [(x0 + 3 * x1) / 4, (y0 + 3 * y1) / 4]);
  }
  const seen = new Set();
  return points.filter(([s, t]) => { const key = `${s.toPrecision(17)},${t.toPrecision(17)}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export function compileSourceProbeState(vertices, faces, axesX, axesY, sample) {
  const points = [];
  const pointIds = new Map();
  const internPoint = (s, t, triangleId, baseline) => {
    const key = `${triangleId}|${s.toPrecision(17)}|${t.toPrecision(17)}`;
    if (pointIds.has(key)) return pointIds.get(key);
    const locate = (axis, value) => {
      let lo = 0, hi = axis.length - 1;
      while (lo + 1 < hi) { const middle = (lo + hi) >>> 1; if (axis[middle] <= value) lo = middle; else hi = middle; }
      if (value === 1) lo = axis.length - 2;
      return [lo, (value - axis[lo]) / (axis[lo + 1] - axis[lo])];
    };
    const [column, fx] = locate(axesX, s);
    const [row, fy] = locate(axesY, t);
    const id = points.length;
    points.push({ s, t, triangleId, baseline, cellId: row * (axesX.length - 1) + column, fx, fy });
    pointIds.set(key, id);
    return id;
  };
  const faceBins = expandedFaceBins(vertices, faces);
  const faceCornerBaselines = faces.map((face) => face.v.map((id) => {
    const point = vertices[id];
    return sample(point.s, point.t, face.tri);
  }));
  const faceChecks = faces.map((face) => {
    const [a, b, c] = face.v.map((id) => vertices[id]);
    const locations = [[(a.s + b.s) / 2, (a.t + b.t) / 2], [(b.s + c.s) / 2, (b.t + c.t) / 2], [(c.s + a.s) / 2, (c.t + a.t) / 2], [(a.s + b.s + c.s) / 3, (a.t + b.t + c.t) / 3]];
    return locations.map(([s, t]) => ({ pointId: internPoint(s, t, face.tri, sample(s, t, face.tri)) }));
  });
  const globalChecks = globalSourceSamples(axesX, axesY).map(([s, t]) => {
    const binX = Math.min(63, Math.floor(s * 64));
    const binY = Math.min(63, Math.floor(t * 64));
    const incident = [];
    for (const faceId of faceBins[binY * 64 + binX]) {
      const face = faces[faceId];
      const [a, b, c] = face.v.map((id) => vertices[id]);
      const weights = sourceWeights(a, b, c, s, t);
      if (!weights) continue;
      incident.push({ faceId, face, weights, baseline: sample(s, t, face.tri) });
    }
    if (!incident.length) throw new Error('source grid sample is not covered by prepared triangles');
    const owner = incident[0];
    return { s, t, owner: { ...owner, pointId: internPoint(s, t, owner.face.tri, owner.baseline) }, incident };
  });
  return { points, faceChecks, faceCornerBaselines, globalChecks };
}

function evaluateCompiledProbe(probe, h, cells) {
  const base = probe.baseline;
  const denominator = h[6] * base.x + h[7] * base.y + h[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-9) throw Error('keystone projective denominator is invalid');
  const numeratorX = h[0] * base.x + h[1] * base.y + h[2];
  const numeratorY = h[3] * base.x + h[4] * base.y + h[5];
  const cell = cells[probe.cellId];
  const { fx, fy } = probe;
  const offsetX = ((1 - fx) * cell.p00[0] + fx * cell.p10[0]) * (1 - fy) + ((1 - fx) * cell.p01[0] + fx * cell.p11[0]) * fy;
  const offsetY = ((1 - fx) * cell.p00[1] + fx * cell.p10[1]) * (1 - fy) + ((1 - fx) * cell.p01[1] + fx * cell.p11[1]) * fy;
  const x = numeratorX / denominator + offsetX;
  const y = numeratorY / denominator + offsetY;
  if (!Number.isFinite(x + y) || x < -1 || x > 2 || y < -1 || y > 2) throw Error('warped point is outside safe extent [-1, 2]');
  return { s: probe.s, t: probe.t, baseX: base.x, baseY: base.y, x, y };
}

function cloneFinalResult(source) {
  const { vertices, triangles, ...metadata } = source;
  return {
    ...structuredClone(metadata),
    vertices: vertices.map(({ s, t, x, y, u, v }) => ({ s, t, x, y, u, v })),
    triangles: triangles.slice(),
  };
}

export function prepareGridWarpMesh(mesh, warp, { side, tolerancePx = TOLERANCE } = {}) {
  if (!mesh || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.triangles)) throw Error('configurable grid requires a trusted source mesh');
  if (!['left','right'].includes(side)) throw Error('v7 warp evaluation requires explicit side');
  const baselineFingerprint=fingerprintBaselineMesh(mesh);
  const metadataFingerprint=JSON.stringify(Object.fromEntries(Object.entries(mesh).filter(([key])=>key!=='vertices'&&key!=='triangles')));
  const meshFingerprint=JSON.stringify([baselineFingerprint,metadataFingerprint]);
  let cache=finalMeshCache.get(mesh);if(!cache){cache=new Map();finalMeshCache.set(mesh,cache);}
  const fingerprint=`${meshFingerprint}|${side}|${tolerancePx}|${JSON.stringify(warp.keystone)}|${JSON.stringify(warp.grid)}`;
  if(cache.has(fingerprint))return cloneFinalResult(cache.get(fingerprint));
  const grid=warp.grid, sample=createBaselineSampler(mesh,{fingerprint:baselineFingerprint}), h=homography(warp.keystone.corners);
  const exactCache=new Map();
  const exactPoint=(point,triId,baseline=null)=>{const key=`${triId}|${point.s.toPrecision(17)}|${point.t.toPrecision(17)}`;if(exactCache.has(key))return exactCache.get(key);const value=exact(point,triId,sample,h,grid,baseline);if(exactCache.size>250000)exactCache.clear();exactCache.set(key,value);return value;};
  const axesX=grid.columnPositions, axesY=grid.rowPositions;
  for(const axis of [axesX,axesY])for(let i=1;i<axis.length;i++)if(axis[i]-axis[i-1]<=1e-10)throw Error('source grid is numerically degenerate');
  const cells=[];for(let row=0;row<axesY.length-1;row++)for(let col=0;col<axesX.length-1;col++){const at=(x,y)=>grid.offsets[y*grid.columns+x];cells.push({dx:axesX[col+1]-axesX[col],dy:axesY[row+1]-axesY[row],sx0:axesX[col],ty0:axesY[row],p00:at(col,row),p10:at(col+1,row),p01:at(col,row+1),p11:at(col+1,row+1)});}
  const originalTriangles=Array.from({length:mesh.triangles.length/3},(_,id)=>mesh.triangles.slice(id*3,id*3+3).map(index=>mesh.vertices[index]));
  const triangleGradients=originalTriangles.map(tri=>{const [A,B,C]=tri,dsB=B.s-A.s,dtB=B.t-A.t,dsC=C.s-A.s,dtC=C.t-A.t,D=dsB*dtC-dtB*dsC,round=32*EPS*(Math.abs(dsB*dtC)+Math.abs(dtB*dsC));if(!(D>round))throw Error('source grid is numerically degenerate');const derivative=q=>{const dB=B[q]-A[q],dC=C[q]-A[q];return [(dB*dtC-dC*dtB)/D,(dsB*dC-dsC*dB)/D];};const [xs,xt]=derivative('x'),[ys,yt]=derivative('y');return {xs,xt,ys,yt};});
  const jacobian=(point,triId,cellId)=>{
    const {xs,xt,ys,yt}=triangleGradients[triId],base=point.baseX===undefined?sample(point.s,point.t,triId):{x:point.baseX,y:point.baseY},W=h[6]*base.x+h[7]*base.y+h[8],U=h[0]*base.x+h[1]*base.y+h[2],V=h[3]*base.x+h[4]*base.y+h[5];
    if(!Number.isFinite(W)||Math.abs(W)<=1e-9)throw Error('keystone projective denominator is invalid');
    const hx=(h[0]*W-h[6]*U)/(W*W),hy=(h[1]*W-h[7]*U)/(W*W),vx=(h[3]*W-h[6]*V)/(W*W),vy=(h[4]*W-h[7]*V)/(W*W);
    const cell=cells[cellId],dx=cell.dx,dy=cell.dy,a=(point.s-cell.sx0)/dx,b=(point.t-cell.ty0)/dy,{p00,p10,p01,p11}=cell;
    const rx=[((p10[0]-p00[0])*(1-b)+(p11[0]-p01[0])*b)/dx,((p01[0]-p00[0])*(1-a)+(p11[0]-p10[0])*a)/dy];
    const ry=[((p10[1]-p00[1])*(1-b)+(p11[1]-p01[1])*b)/dx,((p01[1]-p00[1])*(1-a)+(p11[1]-p10[1])*a)/dy];
    const fxs=hx*xs+hy*ys+rx[0],fxt=hx*xt+hy*yt+rx[1],fys=vx*xs+vy*ys+ry[0],fyt=vx*xt+vy*yt+ry[1],p=fxs*fyt,q=fxt*fys,det=p-q;
    if(![fxs,fxt,fys,fyt,det].every(Number.isFinite)||!(det>Math.max(1e-9,32*EPS*(Math.abs(p)+Math.abs(q)))))throw Error('grid warp folds or collapses a triangle');
  };
  const topologyKey=`${side}|${meshFingerprint}|${JSON.stringify(axesX)}|${JSON.stringify(axesY)}`;
  let topologyMap=initialTopologyCache.get(mesh);if(!topologyMap){topologyMap=new Map();initialTopologyCache.set(mesh,topologyMap);}
  let cachedTopology=topologyMap.get(topologyKey);
  let vertices, faces, controlIds;
  if(cachedTopology){vertices=cachedTopology.vertices.slice();faces=cachedTopology.faces.slice();controlIds=cachedTopology.controlIds.slice();}
  else {
  vertices=[]; const lookup=new Map(); faces=[];
  const add=(p,protectedPoint=false)=>{
    const qs=Math.round(p.s*1e12),qt=Math.round(p.t*1e12);let key=`${qs},${qt}`,old=lookup.get(key);
    if(old===undefined)for(let ds=-1;ds<=1&&old===undefined;ds++)for(let dt=-1;dt<=1&&old===undefined;dt++){const neighbor=`${qs+ds},${qt+dt}`;if(lookup.has(neighbor)){key=neighbor;old=lookup.get(neighbor);}}
    if(old!==undefined){const q=vertices[old];if(Math.hypot(q.s-p.s,q.t-p.t)>1e-12||['x','y','u','v'].some(k=>Math.abs(q[k]-p[k])>1e-9))throw Error('source grid is numerically degenerate');if(protectedPoint)q.protected=true;return old;}
    if(vertices.length>=CAP)throw Error('mesh vertex capacity exceeded');
    const id=vertices.length; vertices.push({...p,protected:protectedPoint});lookup.set(key,id);return id;
  };
  controlIds=[];for(const t of axesY)for(const s of axesX){const b=sample(s,t);controlIds.push(add({...b,protected:true},true));}
  for(let ti=0;ti<mesh.triangles.length;ti+=3){
    const ids=mesh.triangles.slice(ti,ti+3), tri=ids.map(i=>mesh.vertices[i]);
    if(cross(...tri)<=0)throw Error('source grid is numerically degenerate');
    const minS=Math.min(...tri.map(p=>p.s)),maxS=Math.max(...tri.map(p=>p.s)),minT=Math.min(...tri.map(p=>p.t)),maxT=Math.max(...tri.map(p=>p.t));
    for(let row=0;row<axesY.length-1;row++){if(axesY[row+1]<minT-1e-14||axesY[row]>maxT+1e-14)continue;
      for(let col=0;col<axesX.length-1;col++){if(axesX[col+1]<minS-1e-14||axesX[col]>maxS+1e-14)continue;
        let poly=tri.map(p=>({...p})); poly=clip(poly,'s',axesX[col],true);poly=clip(poly,'s',axesX[col+1],false);poly=clip(poly,'t',axesY[row],true);poly=clip(poly,'t',axesY[row+1],false);
        if(poly.length<3)continue;
        const denominators=poly.map(p=>{const base=sample(p.s,p.t,Math.floor(ti/3));return h[6]*base.x+h[7]*base.y+h[8];});
        if(denominators.some(v=>!Number.isFinite(v)||Math.abs(v)<=1e-9)||denominators.some(v=>Math.sign(v)!==Math.sign(denominators[0])))throw Error('keystone projective denominator crosses a clipped grid region');
        const origin=poly[0],areaTerms=[];for(let i=1;i<poly.length-1;i++){const abS=poly[i].s-origin.s,abT=poly[i].t-origin.t,acS=poly[i+1].s-origin.s,acT=poly[i+1].t-origin.t;areaTerms.push(abS*acT-abT*acS);}const area=areaTerms.reduce((sum,value)=>sum+value,0),areaRound=32*EPS*areaTerms.reduce((sum,value)=>sum+Math.abs(value),0);if(area<=areaRound)continue;
        const center={s:poly.reduce((v,p)=>v+p.s,0)/poly.length,t:poly.reduce((v,p)=>v+p.t,0)/poly.length};
        const triId=Math.floor(ti/3), centerBase=sample(center.s,center.t,triId); const ring=poly.map(p=>add({...p,triangleId:triId})); const ci=add({...centerBase,triangleId:triId});
        for(let k=0;k<ring.length;k++){const ids2=[ci,ring[k],ring[(k+1)%ring.length]],pts=ids2.map(id=>vertices[id]),area=cross(...pts),round=32*EPS*(Math.abs((pts[1].s-pts[0].s)*(pts[2].t-pts[0].t))+Math.abs((pts[1].t-pts[0].t)*(pts[2].s-pts[0].s)));if(area>round)faces.push({v:ids2,tri:triId,cell:row*(axesX.length-1)+col,depth:0});}
      }
    }
  }
  const connectedVertices=new Set();for(const face of faces)for(const id of face.v)connectedVertices.add(id);
  if(controlIds.some(id=>!connectedVertices.has(id)))throw Error('grid control point is not connected to prepared triangles');
  cachedTopology={vertices:vertices.map(point=>({...point})),faces:faces.map(face=>({...face,v:[...face.v]})),controlIds:[...controlIds],probeState:null};topologyMap.set(topologyKey,cachedTopology);while(topologyMap.size>2)topologyMap.delete(topologyMap.keys().next().value);
  }
  if(!cachedTopology.probeState)cachedTopology.probeState=compileSourceProbeState(vertices,faces,axesX,axesY,sample);
  let probeState=cachedTopology.probeState;
  vertices=vertices.map(point=>exactPoint(point,point.triangleId,point));
  const vertexLookup=new Map();for(let i=0;i<vertices.length;i++){const p=vertices[i];vertexLookup.set(`${Math.round(p.s*1e12)},${Math.round(p.t*1e12)}`,i);}
  const addVertex=p=>{
    const qs=Math.round(p.s*1e12),qt=Math.round(p.t*1e12);let key=`${qs},${qt}`,old=vertexLookup.get(key);
    if(old===undefined)for(let ds=-1;ds<=1&&old===undefined;ds++)for(let dt=-1;dt<=1&&old===undefined;dt++){const neighbor=`${qs+ds},${qt+dt}`;if(vertexLookup.has(neighbor)){key=neighbor;old=vertexLookup.get(neighbor);}}
    if(old!==undefined){const q=vertices[old];if(Math.hypot(q.s-p.s,q.t-p.t)>1e-12||['x','y','u','v'].some(k=>Math.abs(q[k]-p[k])>1e-9))throw Error('source grid is numerically degenerate');return old;}
    if(vertices.length>=CAP)throw Error('mesh vertex capacity exceeded');const id=vertices.length;vertices.push(p);vertexLookup.set(key,id);return id;
  };
  for(let faceIndex=0;faceIndex<faces.length;faceIndex++){const values=probeState.faceCornerBaselines[faceIndex].map(base=>h[6]*base.x+h[7]*base.y+h[8]);if(values.some(v=>!Number.isFinite(v)||Math.abs(v)<=1e-9)||values.some(v=>Math.sign(v)!==Math.sign(values[0])))throw Error('keystone projective denominator crosses a clipped grid region');}
  const midpoint=(a,b,tri)=>{const s=(a.s+b.s)/2,t=(a.t+b.t)/2;return exactPoint({s,t},tri);};
  const gpuError=(point,ids,weights,gpuX,gpuY)=>{
    const a=ids[0],b=ids[1],c=ids[2];
    let x=0;x+=gpuX[a]*weights[0];x+=gpuX[b]*weights[1];x+=gpuX[c]*weights[2];
    let y=0;y+=gpuY[a]*weights[0];y+=gpuY[b]*weights[1];y+=gpuY[c]*weights[2];
    return Math.hypot((point.x-x)*1920,(point.y-y)*1080);
  };
  let sampledMaxErrorPx=Infinity;
  for(let iteration=0;iteration<=MAX_DEPTH;iteration++){
    const candidatePoints=probeState.points.map((probe)=>evaluateCompiledProbe(probe,h,cells));
    const gpuX=new Float64Array(vertices.length),gpuY=new Float64Array(vertices.length);
    for(let i=0;i<vertices.length;i++){gpuX[i]=(Math.fround(2*vertices[i].x-1)+1)/2;gpuY[i]=(1-Math.fround(1-2*vertices[i].y))/2;}
    const marks=[], markSet=new Set(), edgeOwners=new Map(), edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
    const markFace=f=>{for(let i=0;i<3;i++){const key=edgeKey(f.v[i],f.v[(i+1)%3]);if(!markSet.has(key)){markSet.add(key);marks.push(key);}if(!edgeOwners.has(key))edgeOwners.set(key,f.tri);}};
    let globalMax=0;
    const faceWeights=[[.5,.5,0],[0,.5,.5],[.5,0,.5],[1/3,1/3,1/3]];
    for(let faceIndex=0;faceIndex<faces.length;faceIndex++){const f=faces[faceIndex];let fail=false;
      for(let checkIndex=0;checkIndex<4;checkIndex++){const p=candidatePoints[probeState.faceChecks[faceIndex][checkIndex].pointId];jacobian(p,f.tri,f.cell);const err=gpuError(p,f.v,faceWeights[checkIndex],gpuX,gpuY);globalMax=Math.max(globalMax,err);if(err>tolerancePx)fail=true;}
      if(fail)markFace(f);
    }
    // Every deterministic lattice/cell probe must be represented accurately in the final mesh.
    for(const check of probeState.globalChecks){const {owner,incident}=check;const ownerFace=faces[owner.faceId],p=candidatePoints[owner.pointId];let ownerWeights=null,referenceX=null,referenceY=null;const seenRegions=new Set();
      for(const entry of incident){const face=faces[entry.faceId],ids=face.v,a=vertices[ids[0]],b=vertices[ids[1]],c=vertices[ids[2]],w=entry.weights;const x=a.x*w[0]+b.x*w[1]+c.x*w[2],y=a.y*w[0]+b.y*w[1]+c.y*w[2];if(entry.faceId===owner.faceId)ownerWeights=w;if(referenceX===null){referenceX=x;referenceY=y;}else if(Math.hypot(x-referenceX,y-referenceY)>1e-9)throw Error('prepared grid topology is not conforming');const regionKey=`${face.tri}|${face.cell}`;if(!seenRegions.has(regionKey)){seenRegions.add(regionKey);jacobian(face.tri===ownerFace.tri?p:{...p,baseX:entry.baseline.x,baseY:entry.baseline.y},face.tri,face.cell);}}
      if(!ownerWeights)throw Error('source grid sample is not covered by prepared triangles');const error=gpuError(p,ownerFace.v,ownerWeights,gpuX,gpuY);globalMax=Math.max(globalMax,error);if(error>tolerancePx)markFace(ownerFace);
    }
    sampledMaxErrorPx=globalMax;if(marks.length===0){if(globalMax>0.5)throw Error('refinement did not meet 0.5px sampled tolerance');break;}if(iteration===MAX_DEPTH)throw Error('refinement did not meet 0.5px sampled tolerance');
    const mids=new Map();if(vertices.length+marks.length>CAP)throw Error('mesh vertex capacity exceeded');for(const key of marks){const [a,b]=key.split(':').map(Number);const p=midpoint(vertices[a],vertices[b],edgeOwners.get(key));mids.set(key,addVertex(p));}
    const next=[];for(const f of faces){const [a,b,c]=f.v,ab=mids.get(edgeKey(a,b)),bc=mids.get(edgeKey(b,c)),ca=mids.get(edgeKey(c,a)),count=[ab,bc,ca].filter(x=>x!==undefined).length;if(!count){next.push(f);continue;}const push=tri=>next.push({...f,v:tri,depth:f.depth+1});
      if(count===3){push([a,ab,ca]);push([ab,b,bc]);push([ca,bc,c]);push([ab,bc,ca]);}
      else if(count===1){if(ab!==undefined){push([a,ab,c]);push([ab,b,c]);}else if(bc!==undefined){push([b,bc,a]);push([bc,c,a]);}else{push([c,ca,b]);push([ca,a,b]);}}
      else { // two-edge case; split around the shared vertex without a hanging edge
        if(ab!==undefined&&bc!==undefined){push([b,bc,ab]);push([a,ab,c]);push([ab,bc,c]);}
        else if(bc!==undefined&&ca!==undefined){push([c,ca,bc]);push([b,bc,a]);push([bc,ca,a]);}
        else {push([a,ab,ca]);push([c,ca,b]);push([ca,ab,b]);}
      }
    }
    faces.length=0;for(const face of next)faces.push(face);for(const f of faces){if(f.depth>MAX_DEPTH)throw Error('refinement depth exceeded');const pts=f.v.map(i=>vertices[i]);relativePositive(...pts);}probeState=compileSourceProbeState(vertices,faces,axesX,axesY,sample);
  }
  const result={...mesh,validationProfile:'relative-source-v1',sampledMaxErrorPx,vertices:vertices.map(({protected:_,...p})=>({s:p.s,t:p.t,x:p.x,y:p.y,u:p.u,v:p.v})),triangles:faces.flatMap(f=>f.v)};
  cache.set(fingerprint,cloneFinalResult(result));while(cache.size>4)cache.delete(cache.keys().next().value);
  return cloneFinalResult(result);
}

export function evaluateGridWarpPoint(mesh, warp, s, t) {
  const sample=createBaselineSampler(mesh,{fingerprint:fingerprintBaselineMesh(mesh)}), h=homography(warp.keystone.corners);
  const point=exact({s,t},sample(s,t).triangleId,sample,h,warp.grid);return [point.x,point.y];
}
