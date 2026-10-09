/** Concrete miniature and the two wall murals of the Re'im west shelter. */
import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
  function path(ctx,data,fill,stroke=null,width=1){
    const p=new Path2D(data);if(fill){ctx.fillStyle=fill;ctx.fill(p);}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke(p);}
  }
  function poly(ctx,points,fill,stroke=null,width=1){path(ctx,'M'+points.map(p=>p.join(',')).join('L')+'Z',fill,stroke,width);}
  function bird(ctx,x,y,scale,dir,detail,graphic,red){
    ctx.save();ctx.translate(x,y);ctx.scale(scale*dir,scale);
    const line=red?'#491022':'#274750',body=red?'#ed829e':graphic?'#aa8260':'#b69976',blue=red?'#9e183f':graphic?'#147fc4':'#1584bb',deep=red?'#65102c':'#185574',light=red?'#f0aabb':'#72cbe2';
    // A long tail, tapered body, prominent beak and folded blue wing follow the mural silhouette.
    path(ctx,'M-1 16 L19 55 Q10 53 6 48 L-11 21 Z',deep);
    path(ctx,'M0 22 L15 49 L8 44 L-6 23 Z',blue);
    path(ctx,'M-12 -13 Q-14 -25 -4 -30 Q6 -35 14 -25 L18 -19 L13 -13 Q11 -6 17 7 Q21 22 11 30 Q-3 35 -13 22 Q-20 8 -15 -4 Z',body,line,graphic?1.8:1.1);
    path(ctx,'M12 -24 L41 -18 L14 -16 Z',red?'#ed829e':graphic?'#b98567':'#bd917b',line,graphic?1.3:.7);
    path(ctx,'M-10 -10 Q2 -8 11 3 Q16 14 12 28 Q-2 25 -8 10 Q-13 -1 -10 -10 Z',blue,line,graphic?1.3:.7);
    path(ctx,'M-10 -10 Q-4 -11 3 -4 L10 12 Q4 6 1 2 Q-4 -3 -10 -5 Z',light);
    path(ctx,'M-11 -13 Q-3 -16 10 -15 L12 -11 Q0 -7 -9 -6 Z',red?'#f8cad4':'#ecdfc8');
    if(detail){
      path(ctx,'M-12 -23 Q-7 -29 0 -29 M-14 1 Q-18 15 -7 25 M-8 5 Q-5 17 4 24',null,red?'#f0aabb':'#e1c6a0',1.2);
      path(ctx,'M-5 -3 Q-1 10 8 21 M0 -1 Q4 10 11 16 M-1 25 L12 44',null,deep,1.1);
      path(ctx,'M-2 -2 Q2 7 7 12 M2 1 L8 10',null,light,.8);
      path(ctx,'M-4 29 L-5 35 M1 30 L1 35',null,line,1.4);
      ctx.beginPath();ctx.arc(3,-23,4.4,0,Math.PI*2);ctx.fillStyle=red?'#f0aabb':'#efe0bd';ctx.fill();
      ctx.beginPath();ctx.arc(3,-23,2.5,0,Math.PI*2);ctx.fillStyle=line;ctx.fill();
      ctx.beginPath();ctx.arc(3.5,-24,.8,0,Math.PI*2);ctx.fillStyle=red?'#f8cad4':'#fff7e0';ctx.fill();
    }
    ctx.restore();
  }
  function plane(ctx,tl,tr,bl,fn,br){
    ctx.save();
    if(br){ctx.beginPath();[tl,tr,br,bl].forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.clip();}
    ctx.transform((tr[0]-tl[0])/100,(tr[1]-tl[1])/100,(bl[0]-tl[0])/100,(bl[1]-tl[1])/100,tl[0],tl[1]);
    ctx.beginPath();ctx.rect(0,0,100,100);ctx.clip();fn();ctx.restore();
  }

export function paintShelterArtwork(ctx, { cx, cy, bodyWidthPx, bodyColor, variant = "normal" }) {
  const mural = variant === "mural";
  const red = bodyColor === NLI_VISUAL_TOKENS.incidentRed;
  const mini = bodyWidthPx <= 32;
  const detail = bodyWidthPx > 52;
  const scale = bodyWidthPx / 116;
  const vertical = .86;
  const edgeStrength = mini ? 1.6 : 1;
  const weight = detail ? 1.1 : Math.max(1.3, .95 / scale) * edgeStrength;
  ctx.save();
  ctx.translate(cx - bodyWidthPx / 2, cy - 97 * scale * vertical / 2);
  ctx.scale(scale, scale * vertical);
  ctx.translate(-2, -8);
  const lt = [2, 24], ct = [49, 8], rt = [118, 16];
  const lb = [6, 105], cb = [51, 103], rb = [118, 96];
  const left = red ? "#943047" : mural ? "#b6dce5" : "#b5b9ad";
  const right = red ? NLI_VISUAL_TOKENS.incidentRed : mural ? "#d3e9ed" : "#e2e1d2";
  poly(ctx, [lt, ct, cb, lb], left);
  poly(ctx, [ct, rt, rb, cb], right);
  if (detail) {
    poly(ctx, [[2,24],[49,8],[49,10],[2,26]], red ? "#a93a53" : "#d1d2c4");
    poly(ctx, [[49,8],[118,16],[118,18],[49,10]], red ? "#d55671" : "#f0eee2");
  }
  if (mural) {
    plane(ctx, lt, ct, lb, () => {
      path(ctx, "M0 88 Q22 94 48 92 Q70 91 100 69", null, red ? "#65102c" : "#9b805f", mini ? 5.5 : 3.8);
      bird(ctx, 29, 43, .88, 1, detail, false, red);
    }, cb);
    plane(ctx, ct, rt, cb, () => {
      path(ctx, "M0 68 Q10 50 20 56 Q34 65 45 72 Q57 82 73 83", null, red ? "#65102c" : "#aa8968", mini ? 5.5 : 3.5);
      bird(ctx, 43, 43, .83, -1, detail, false, red);
    }, rb);
  }
  const wallPoint = (u, v) => {
    const tx = ct[0] + (rt[0] - ct[0]) * u / 100, ty = ct[1] + (rt[1] - ct[1]) * u / 100;
    const bx = cb[0] + (rb[0] - cb[0]) * u / 100, by = cb[1] + (rb[1] - cb[1]) * u / 100;
    return [tx + (bx - tx) * v / 100, ty + (by - ty) * v / 100];
  };
  const wallPoly = (points, fill) => poly(ctx, points.map(([u, v]) => wallPoint(u, v)), fill);
  // Optical widening keeps the dark recess distinct from the right outer edge at map sizes.
  const x = mini ? 62 : 78, top = mini ? 10 : 13, reveal = mini ? 2 : 6, end = mini ? 89 : 95;
  wallPoly([[x-1,top-1],[97,top-1],[97,95],[x-1,95]], red ? "#f0aabb" : "#eeecdf");
  wallPoly([[x,top],[end,top],[end,92],[x,92]], red ? "#65102c" : "#526668");
  wallPoly([[x,top],[end,top],[x+reveal,top+11],[x+reveal,92],[x,92]], red ? "#f8cad4" : "#f4f2e5");
  wallPoly([[x+reveal,top+11],[end,top],[end,92],[x+reveal,92]], red ? "#380e1b" : mini ? "#15282e" : "#566b6e");
  wallPoly([[x,92],[end,92],[end,88],[x+reveal,87]], red ? "#ed829e" : "#aabcb7");
  path(ctx, "M" + wallPoint(x,top).join(" ") + "L" + wallPoint(end,top).join(" ") + "L" + wallPoint(end,92).join(" "), null, red ? "#491022" : "#253a40", detail ? .7 : .55 / scale * edgeStrength);
  path(ctx, "M49 8L51 103", null, red ? "#65102c" : mural ? "#527a84" : "#667575", detail ? 1 : .65 / scale * edgeStrength);
  const outline = "M2 24L49 8L118 16L118 96L51 103L6 105Z";
  // A light exterior halo separates the miniature from dark maps and projection.
  path(ctx, outline, null, red ? "#f8cad4" : "#eef2e8", weight + .7 / scale * edgeStrength);
  path(ctx, outline, null, red ? "#491022" : "#263d43", weight);
  ctx.restore();
}
