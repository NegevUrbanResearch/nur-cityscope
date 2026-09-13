import { describe, expect, it } from 'vitest';
import { createNameFieldGeometry, buildNliNameField } from '../../frontend/src/shared/nli-name-field-geometry.js';
import { nameRectangleFits } from '../../frontend/src/shared/nli-name-field-layout.js';

const bounds = [[34.1,31.1],[34.9,31.8]];
const geometry = () => createNameFieldGeometry({bounds,heading:41});
const feature = (pid,lon=34.5,lat=31.4) => ({type:'Feature',geometry:{type:'Point',coordinates:[lon+.001,lat+.001]},properties:{pid,hebrew_name:`שם ${pid}`,status:'Murdered',source_lon:lon,source_lat:lat,location:'בארי'}});

describe('canonical name field geometry',()=>{
  it('round trips WGS84 through the common label-aligned plane',()=>{
    const g=geometry(); const point=[34.55,31.42];
    const actual=g.unproject(g.project(point));
    expect(actual[0]).toBeCloseTo(point[0],10); expect(actual[1]).toBeCloseTo(point[1],10);
    expect(g.polygons).toHaveLength(2); expect(g.referenceZoom).toBeGreaterThan(10);
  });
  it('uses identical geometry for both clients without per-view camera input',()=>{
    expect(geometry().polygons).toEqual(geometry().polygons);
  });
  it('rejects degenerate model bounds',()=>{
    expect(()=>createNameFieldGeometry({bounds:[[34,31],[34,31]]})).toThrow();
  });
  it('limits placement to calibrated source areas and identifies fully visible spans',()=>{
    const g=createNameFieldGeometry({bounds,heading:41,sourceUv:{left:[[.3,.3],[.7,.3],[.7,.7],[.3,.7]],right:[[.3,.3],[.7,.3],[.7,.7],[.3,.7]]}});
    const field=buildNliNameField({features:Array.from({length:40},(_,i)=>feature(i+1))},g,{measureText:()=>60,fontSizes:[10]});
    for(const f of field.geojson.features){
      const [x,y]=g.project(f.geometry.coordinates);
      const spans=Object.entries(g.spanPolygons).filter(([,p])=>nameRectangleFits({x,y,width:Math.ceil(60*1.12+6)-.001,height:17-.001},[p])).map(([span])=>span);
      expect(spans.length).toBeGreaterThan(0);
      expect(f.properties.visible_spans).toEqual(spans);
    }
  });
});

describe('name field data',()=>{
  it('sorts by Hebrew display text and ignores unrelated Latin name fields',()=>{
    const first=feature(1); first.properties.hebrew_name='תמר כהן'; first.properties.first_name='Zed'; first.properties.last_name='Aardvark';
    const second=feature(2); second.properties.hebrew_name='אורי לוי'; second.properties.first_name='Adam'; second.properties.last_name='Zulu';
    const field=buildNliNameField({features:[first,second]},geometry(),{measureText:()=>20,fontSizes:[10]});
    const byPid=new Map(field.geojson.features.map((item)=>[item.properties.pid,geometry().project(item.geometry.coordinates)]));
    expect(byPid.get('2')[0]).toBeGreaterThan(byPid.get('1')[0]);
  });
  it('retains place metadata without reserving a rendered heading',()=>{
    const first=feature(1); first.properties.location='Nova';
    const second=feature(2); second.properties.location="Re'im";
    const g=geometry();
    const field=buildNliNameField({features:[first,second]},g);
    expect(field.groupGeojson.features).toHaveLength(2);
    expect(new Set(field.geojson.features.map(f=>f.properties.group_id)).size).toBe(2);
    const nova=field.groupGeojson.features.find(f=>f.properties.group_id==='nova');
    expect(nova.properties).toMatchObject({name:'נובה',place_ids:['custom-reim-parking']});
    expect(nova.properties.visible_spans).toEqual([]);
    expect(field.byPid.get('1').sourceCoordinates).toEqual([34.5,31.4]);
  });
  it('includes people killed and excludes survivors without changing the source collection',()=>{
    const statuses=['Murdered','Killed on duty','Murdered in captivity','Kidnap survivor'];
    const data={features:statuses.map((status,i)=>{const f=feature(i+1);f.properties.status=status;return f;})};
    const before=JSON.stringify(data);
    const field=buildNliNameField(data,geometry());
    expect(field.geojson.features.map(f=>f.properties.pid)).toEqual(['1','2','3']);
    expect(field.diagnostics).toMatchObject({total:3,sourceTotal:4,excluded:1});
    expect(JSON.stringify(data)).toBe(before);
  });
  it('preserves every PID, source coordinates and original data while moving coincident names',()=>{
    const data={type:'FeatureCollection',features:Array.from({length:20},(_,i)=>feature(i+1))};
    const before=JSON.stringify(data);
    const field=buildNliNameField(data,geometry(),{measureText:t=>t.length*6,fontSizes:[12],datasetVersion:'v1'});
    expect(field.geojson.features).toHaveLength(20);
    expect(new Set(field.geojson.features.map(f=>f.geometry.coordinates.join(','))).size).toBe(20);
    expect(field.byPid.get('1').sourceCoordinates).toEqual([34.5,31.4]);
    expect(JSON.stringify(data)).toBe(before);
    expect(field.diagnostics.unplaced).toEqual([]);
  });
  it('reports insufficient capacity instead of serving a partial replacement',()=>{
    const g={...geometry(),polygons:[[[0,0],[1,0],[1,1],[0,1]]]};
    expect(()=>buildNliNameField({features:[feature(1)]},g,{fontSizes:[12],measureText:()=>90})).toThrow(/capacity/i);
  });
  it('rejects duplicate IDs and names without any usable name',()=>{
    expect(()=>buildNliNameField({features:[feature(1),feature(1)]},geometry())).toThrow(/duplicate/i);
    const f=feature(2);f.properties.hebrew_name='';
    expect(()=>buildNliNameField({features:[f]},geometry())).toThrow(/name/i);
  });
});
