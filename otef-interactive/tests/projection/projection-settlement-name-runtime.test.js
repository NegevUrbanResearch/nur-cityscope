import { expect, test, vi } from "vitest";
import { createProjectionSettlementNameAdapter } from "../../frontend/src/projection/projection-settlement-name-adapter.js";
import { bindProjectionSettlementNames } from "../../frontend/src/projection/projection-settlement-name-runtime.js";
import { resolveProjectionSceneLayers } from "../../frontend/src/projection/projection-surface-compositor.js";
import { getLayerLifecycleRuntime } from '../../frontend/src/shared/layer-lifecycle-fade.js';

const catalog = { entries: [{ citycode: "0067", text: "נירים", lng: 34.4, lat: 31.3 }, { citycode: "0424", text: "מחוץ", lng: 34.2, lat: 31.2 }] };

test.each(['groups','paint','missing'])('async %s redraw failures are consumed and invalidate painted readiness', async kind => {
  const data=contextFor(settingsFixture()),adapter=createProjectionSettlementNameAdapter({document:fakeCanvasDocument(),output:'left'});
  const onError=vi.fn();let rejectDraw;
  const onDraw=vi.fn(()=>rejectDraw ? rejectDraw.promise : Promise.resolve());
  const map=kind==='paint'?{getLayer:()=>true,getPaintProperty:()=>1,setPaintProperty(){}}:undefined;
  const runtime=bindProjectionSettlementNames({dataContext:data,adapter,catalog,map,getGroups:()=>data.state.groups,onDraw,onError});
  await runtime.whenReady();expect(runtime.getReadiness().ready).toBe(true);
  let reject;rejectDraw={promise:new Promise((resolve,fail)=>{reject=fail;})};
  if(kind==='groups') data.emit('layerGroups');
  if(kind==='paint') getLayerLifecycleRuntime(map).stageMapLayer('projector_base.שמות_יישובים',{id:'projector_base__שמות_יישובים__labels',type:'symbol',paint:{'text-opacity':1}});
  if(kind==='missing'){data.state.settings=null;data.state.revision=0;data.state.error='Initialization required';data.emit('settlementNames');}
  const waiting=runtime.whenReady().catch(error=>error);
  reject(new Error('Settlement compositor draw failed'));
  await vi.waitFor(()=>expect(onError).toHaveBeenCalledWith(expect.objectContaining({message:'Settlement compositor draw failed'})));
  expect(runtime.getReadiness()).toMatchObject({ready:false,pending:false,failed:true,error:'Settlement compositor draw failed'});
  expect(await waiting).toBeInstanceOf(Error);runtime();if(map)getLayerLifecycleRuntime(map).dispose();
});

test('a pending group redraw cannot acknowledge or fail newly committed labels', async () => {
  const data=contextFor(settingsFixture()),adapter=createProjectionSettlementNameAdapter({document:fakeCanvasDocument(),output:'left'});
  const draws=[],onError=vi.fn();let asynchronous=false;
  const runtime=bindProjectionSettlementNames({dataContext:data,adapter,catalog,getGroups:()=>data.state.groups,onError,
    onDraw:()=>asynchronous?new Promise((resolve,reject)=>draws.push({resolve,reject})):Promise.resolve()});
  await runtime.whenReady();asynchronous=true;data.emit('layerGroups');
  expect(runtime.getReadiness()).toMatchObject({ready:false,pending:true});
  data.state.revision++;data.emit('settlementNames');
  await vi.waitFor(()=>expect(draws).toHaveLength(2));
  draws[0].reject(new Error('obsolete draw failed'));draws[1].resolve();await runtime.whenReady();
  expect(onError).not.toHaveBeenCalled();expect(runtime.getReadiness()).toMatchObject({ready:true,pending:false,failed:false,committedRevision:4});runtime();
});

test('latest redraw paint establishes readiness without awaiting an obsolete stalled paint', async () => {
  const data=contextFor(settingsFixture()),adapter=createProjectionSettlementNameAdapter({document:fakeCanvasDocument(),output:'left'});
  const draws=[];let asynchronous=false;
  const runtime=bindProjectionSettlementNames({dataContext:data,adapter,catalog,getGroups:()=>data.state.groups,
    onDraw:()=>asynchronous?new Promise((resolve,reject)=>draws.push({resolve,reject})):Promise.resolve()});
  await runtime.whenReady();asynchronous=true;data.emit('layerGroups');data.emit('layerGroups');
  const ready=vi.fn();const waiting=runtime.whenReady().then(ready);draws[1].resolve();
  await vi.waitFor(()=>expect(ready).toHaveBeenCalled());expect(runtime.getReadiness()).toMatchObject({ready:true,pending:false});
  draws[0].reject(new Error('obsolete stalled paint'));await waiting;
  expect(runtime.getReadiness()).toMatchObject({ready:true,failed:false});runtime();
});

test('successful visibility repaint cannot clear missing initialization readiness errors', async () => {
  const data=contextFor(settingsFixture()),adapter=createProjectionSettlementNameAdapter({document:fakeCanvasDocument(),output:'left'});
  const runtime=bindProjectionSettlementNames({dataContext:data,adapter,catalog,getGroups:()=>data.state.groups,onDraw:async()=>{}});
  await runtime.whenReady();data.state.settings=null;data.state.revision=0;data.state.error='Initialization required';data.emit('settlementNames');
  await expect(runtime.whenReady()).rejects.toThrow('Initialization required');data.emit('layerGroups');
  await expect(runtime.whenReady()).rejects.toThrow('Initialization required');
  expect(runtime.getReadiness()).toMatchObject({ready:false,pending:false,failed:true});runtime();
});

test('underlying group and paint switches stay irrelevant to an active landmark override', async () => {
  const data=contextFor(settingsFixture()),adapter=createProjectionSettlementNameAdapter({document:fakeCanvasDocument(),output:'left'}),onDraw=vi.fn(async()=>{});
  const map={getLayer:()=>true,getPaintProperty:()=>0,setPaintProperty(){}};
  const runtime=bindProjectionSettlementNames({dataContext:data,adapter,catalog,map,getCalibrationActive:()=>true,getGroups:()=>data.state.groups,onDraw});
  await runtime.whenReady();const count=onDraw.mock.calls.length;data.state.groups[0].enabled=false;data.emit('layerGroups');
  getLayerLifecycleRuntime(map).stageMapLayer('projector_base.שמות_יישובים',{id:'projector_base__שמות_יישובים__labels',type:'symbol',paint:{'text-opacity':0}});
  expect(onDraw).toHaveBeenCalledTimes(count);expect(runtime.getReadiness()).toMatchObject({ready:true,pending:false});runtime();getLayerLifecycleRuntime(map).dispose();
});

test('readiness identifies desired and committed placement/style/catalog and waits for compositor paint', async () => {
  const data = contextFor(settingsFixture()), callbacks = [], draws = [];
  const adapter = { prepare: vi.fn(async () => ({})), commit: vi.fn(), setVisible() {}, applyScaledOpacity() {}, descriptor: () => null };
  const runtime = bindProjectionSettlementNames({dataContext:data,adapter,catalog,onReadiness:state=>callbacks.push(state),
    onDraw:() => new Promise(resolve => draws.push(resolve))});
  await vi.waitFor(() => expect(adapter.commit).toHaveBeenCalledTimes(1));
  expect(runtime.getReadiness()).toMatchObject({desiredRevision:3,committedRevision:3,pending:true,ready:false,failed:false});
  draws.shift()(); await runtime.whenReady();
  const first = runtime.getReadiness(); expect(first).toMatchObject({pending:false,ready:true,catalogIdentity:expect.any(String),settingsIdentity:expect.any(String)});
  data.state.settings.outputs.left['0067']={x:42,y:70}; data.state.revision++; data.emit('settlementNames');
  expect(runtime.getReadiness()).toMatchObject({desiredRevision:4,committedRevision:3,pending:true,ready:false});
  await vi.waitFor(()=>expect(adapter.commit).toHaveBeenCalledTimes(2)); draws.shift()(); await runtime.whenReady();
  expect(runtime.getReadiness().settingsIdentity).not.toBe(first.settingsIdentity);
  expect(callbacks.at(-1)).toMatchObject({desiredRevision:4,committedRevision:4,pending:false,failed:false}); runtime();
});

test('stale settlement prepare and paint cannot acknowledge a newer generation', async () => {
  const data = contextFor(settingsFixture()), preparations = [], paints = [];
  const adapter = { prepare:() => new Promise(resolve=>preparations.push(resolve)), commit:vi.fn(),setVisible(){},applyScaledOpacity(){},descriptor:()=>null };
  const runtime=bindProjectionSettlementNames({dataContext:data,adapter,catalog,onDraw:()=>new Promise(resolve=>paints.push(resolve))});
  await vi.waitFor(()=>expect(preparations).toHaveLength(1)); preparations.shift()({});
  await vi.waitFor(()=>expect(adapter.commit).toHaveBeenCalledTimes(1));
  data.state.revision++; data.emit('settlementNames'); paints.shift()();
  await vi.waitFor(()=>expect(preparations).toHaveLength(1));
  expect(runtime.getReadiness()).toMatchObject({desiredRevision:4,committedRevision:3,ready:false,pending:true});
  preparations.shift()({}); await vi.waitFor(()=>expect(adapter.commit).toHaveBeenCalledTimes(2)); paints.shift()(); await runtime.whenReady();
  expect(runtime.getReadiness()).toMatchObject({desiredRevision:4,committedRevision:4,pending:false,ready:true});runtime();
});

test('local calibration waits for prepared labels and overrides opacity without changing settings', async () => {
  const doc=fakeCanvasDocument();const adapter=createProjectionSettlementNameAdapter({document:doc,output:'left'});
  const data=contextFor(settingsFixture()); const before=structuredClone(data.state.settings); let active=true;
  const map={getLayer:()=>true,getPaintProperty:()=>0};
  const runtime=bindProjectionSettlementNames({dataContext:data,adapter,catalog,map,getCalibrationActive:()=>active,getGroups:()=>data.state.groups});
  await runtime.whenReady(); expect(runtime.getReadiness().ready).toBe(true); expect(adapter.descriptor().opacity).toBe(1);
  const paintCount = doc.paints.length;
  active=false;runtime.refreshVisibility();expect(doc.paints).toHaveLength(paintCount);expect(data.state.settings).toEqual(before);runtime();
});

test('startup does not query opacity before the settlement map layer exists', async () => {
  const adapter = createProjectionSettlementNameAdapter({ document: fakeCanvasDocument(), output: 'right' });
  const data = contextFor(settingsFixture());
  const map = { getLayer: vi.fn(() => undefined), getPaintProperty: vi.fn(() => { throw new Error('layer is not installed'); }) };
  const onError = vi.fn(), onDraw = vi.fn();
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, map, onError, onDraw });
  await vi.waitFor(() => expect(adapter.getLabels()).toHaveLength(1));
  expect(onError).not.toHaveBeenCalled();
  expect(map.getPaintProperty).not.toHaveBeenCalled();
  expect(onDraw).toHaveBeenCalled();
  dispose();
});

function settingsFixture() {
  return {
    baseline: {
      captureId: "fixture-settlement-name", captureDigest: "a".repeat(64), sourceDigest: "b".repeat(64), catalogDigest: "c".repeat(64),
      predecessor: { revision: 1, configDigest: "d".repeat(64) }, successor: { revision: 2, configDigest: "e".repeat(64) },
      outputs: { left: { "0067": { x: 510, y: 350 } }, right: { "0067": { x: 1200, y: 360 } } },
    },
    style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
    outputs: { left: {}, right: { "0067": { x: 1200, y: 360 } } },
  };
}

function fakeCanvasDocument() {
  const paints = [];
  const images = [];
  const document = {
    paints, images,
    fonts: { load: async (spec) => { if (document.fonts.fail) throw new Error("font failed"); return [spec]; } },
    createElement() {
      const canvas = { width: 8, height: 8, getContext() {
        const context = {
          font: "", globalAlpha: 1,
          measureText: () => ({ width: 12, actualBoundingBoxLeft: 6, actualBoundingBoxRight: 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
          clearRect() {}, translate() {}, rotate() {}, setTransform() {}, save() {}, restore() {},
          drawImage(source) { images.push({ text: source.text, opacity: context.globalAlpha }); },
          getImageData: () => ({ data: new Uint8ClampedArray(64) }),
          strokeText() {},
          fillText(text) { canvas.text = text; paints.push({ op: "fill", text, globalAlpha: context.globalAlpha, canvasWidth: canvas.width }); },
        };
        return context;
      } };
      return canvas;
    },
  };
  return document;
}

function contextFor(settings) {
  const listeners = { settlementNames: new Set(), layerGroups: new Set() };
  const state = { settings: structuredClone(settings), revision: 3, error: settings ? null : "Initialization required", groups: [{ id: "projector_base", enabled: true, layers: [{ id: "שמות_יישובים", enabled: true }] }] };
  return {
    state,
    getSettlementNameSettings: () => state.settings,
    getSettlementNameRevision: () => state.revision,
    getSettlementNameError: () => state.error,
    subscribe(key, listener) {
      listeners[key]?.add(listener);
      if (key === "settlementNames") listener({ settings: state.settings, revision: state.revision, error: state.error });
      if (key === "layerGroups") listener(state.groups);
      return () => listeners[key]?.delete(listener);
    },
    emit(key) {
      const payload = key === "layerGroups" ? state.groups : { settings: state.settings, revision: state.revision, error: state.error };
      for (const listener of listeners[key] || []) listener(payload);
    },
  };
}

test("one accepted position redraws settlements without touching the other output or people names", async () => {
  const doc = fakeCanvasDocument();
  const left = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const right = createProjectionSettlementNameAdapter({ document: doc, output: "right" });
  const people = { prepare: vi.fn(), commit: vi.fn() };
  const draws = [];
  const data = contextFor(settingsFixture());
  const disposeLeft = bindProjectionSettlementNames({ dataContext: data, adapter: left, catalog, getGroups: () => data.state.groups, onDraw: () => draws.push("left"), onError: vi.fn() });
  const disposeRight = bindProjectionSettlementNames({ dataContext: data, adapter: right, catalog, getGroups: () => data.state.groups, onDraw: () => draws.push("right"), onError: vi.fn() });
  await vi.waitFor(() => expect(left.getLabels().find((item) => item.citycode === "0067")?.x).toBe(510));
  draws.length = 0;
  data.state.settings.outputs.left["0067"] = { x: 20, y: 30 };
  data.state.revision += 1;
  data.emit("settlementNames");
  await vi.waitFor(() => expect(left.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 20, y: 30 }));
  expect(right.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 1200, y: 360 });
  expect(draws.every((draw) => draw === "left" || draw === "right")).toBe(true);
  expect(people.prepare).not.toHaveBeenCalled();
  expect(people.commit).not.toHaveBeenCalled();
  expect(resolveProjectionSceneLayers({ image: {}, map: {}, settlements: left.descriptor(), names: { source: {} }, caption: {}, pattern: {}, legend: {} }).map((layer) => layer.id))
    .toEqual(["image", "map", "settlements", "names", "caption", "pattern", "legend"]);
  disposeLeft();
  disposeRight();
});

test("context style updates both outputs and wall rotation does not overwrite it", async () => {
  const doc = fakeCanvasDocument();
  const left = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const right = createProjectionSettlementNameAdapter({ document: doc, output: "right" });
  const data = contextFor(settingsFixture());
  data.namesWall = { rotateDeg: 35 };
  const disposeLeft = bindProjectionSettlementNames({ dataContext: data, adapter: left, catalog, getGroups: () => data.state.groups, onDraw: () => {}, onError: vi.fn() });
  const disposeRight = bindProjectionSettlementNames({ dataContext: data, adapter: right, catalog, getGroups: () => data.state.groups, onDraw: () => {}, onError: vi.fn() });
  await vi.waitFor(() => expect(left.getLabels()[0].rotateDeg).toBe(35));
  data.namesWall.rotateDeg = 70;
  data.emit("settlementNames");
  await vi.waitFor(() => expect(left.getLabels()[0].rotateDeg).toBe(35));
  expect(right.getLabels()[0].rotateDeg).toBe(35);
  data.state.settings.style = { ...data.state.settings.style, fontPx: 24, rotateDeg: -20 };
  data.state.revision += 1;
  data.emit("settlementNames");
  await vi.waitFor(() => expect(left.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 510, y: 350, rotateDeg: -20 }));
  expect(right.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 1200, y: 360, rotateDeg: -20 });
  data.state.settings.style = { ...data.state.settings.style, rotateDeg: 12 };
  data.state.revision += 1;
  data.emit("settlementNames");
  await vi.waitFor(() => expect(left.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 510, y: 350, rotateDeg: 12 }));
  expect(right.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 1200, y: 360, rotateDeg: 12 });
  disposeLeft();
  disposeRight();
});

test("layer visibility never discards stored positions", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const data = contextFor(settingsFixture());
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, getGroups: () => data.state.groups, onDraw: () => {}, onError: vi.fn() });
  await vi.waitFor(() => expect(adapter.getLabels()).toHaveLength(1));
  data.state.groups[0].layers[0].enabled = false;
  data.emit("layerGroups");
  expect(adapter.descriptor().opacity).toBe(0);
  expect(adapter.getLabels()[0]).toMatchObject({ citycode: "0067", x: 510, y: 350 });
  expect(data.state.settings.outputs.left).toEqual({});
  dispose();
});

test("adopts the current lifecycle text-opacity when binding after the first write", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const data = contextFor(settingsFixture());
  data.state.settings.baseline.outputs.left["0424"] = { x: 40, y: 80 };
  const map = {
    getPaintProperty(id, property) {
      if (id === "projector_base__שמות_יישובים__labels" && property === "text-opacity") {
        return ["case", ["in", ["get", "cityname"], ["literal", ["נירים"]]], 1, 0.08];
      }
      return undefined;
    },
  };
  const dispose = bindProjectionSettlementNames({
    dataContext: data, adapter, catalog, map, getGroups: () => data.state.groups, onDraw: () => {}, onError: vi.fn(),
  });
  await vi.waitFor(() => expect(adapter.getLabels()).toHaveLength(2));
  const fills = doc.paints.filter((paint) => paint.op === "fill");
  expect(fills.filter((paint) => paint.text === "נירים").at(-1).globalAlpha).toBe(1);
  expect(doc.images.filter(image => image.text === "מחוץ").at(-1).opacity).toBeCloseTo(0.08);
  dispose();
});

test("hides canvas names when the pack is off even if the layer flag stays on", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const data = contextFor(settingsFixture());
  data.state.groups[0].enabled = false;
  data.state.groups[0].layers[0].enabled = true;
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, getGroups: () => data.state.groups, onDraw: () => {}, onError: vi.fn() });
  await vi.waitFor(() => expect(adapter.getLabels()[0]).toMatchObject({ citycode: "0067", x: 510, y: 350 }));
  expect(adapter.descriptor()?.opacity).toBe(0);
  dispose();
});

test("fonts fail visibly without fallback coordinates", async () => {
  const doc = fakeCanvasDocument();
  doc.fonts.fail = true;
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "right" });
  const onError = vi.fn();
  const data = contextFor(settingsFixture());
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, getGroups: () => data.state.groups, onDraw: vi.fn(), onError });
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(String(onError.mock.calls[0][0].message)).toMatch(/font/i);
  expect(adapter.getLabels()).toEqual([]);
  expect(data.state.settings.outputs.right["0067"]).toEqual({ x: 1200, y: 360 });
  dispose();
});

test("missing initialized settings disables labels with a setup error", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const onError = vi.fn();
  const data = contextFor(null);
  data.state.revision = 0;
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, getGroups: () => data.state.groups, onDraw: vi.fn(), onError });
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(String(onError.mock.calls[0][0].message)).toMatch(/Initialization required/);
  expect(adapter.getLabels()).toEqual([]);
  dispose();
});

test("a later missing initialization hides labels already on screen and shows the setup error", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const alert = { className: "", style: {}, textContent: "", setAttribute() {}, remove() { host.child = null; } };
  const host = {
    child: null,
    querySelector(selector) { return selector === ".projection-browser-error" ? this.child : null; },
    appendChild(node) { this.child = node; },
    ownerDocument: { createElement: () => alert },
  };
  const onDraw = vi.fn();
  const onError = vi.fn();
  const data = contextFor(settingsFixture());
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, host, getGroups: () => data.state.groups, onDraw, onError });
  await vi.waitFor(() => expect(adapter.descriptor()?.opacity).toBe(1));
  data.state.settings = null;
  data.state.revision = 0;
  data.state.error = "Initialization required";
  data.emit("settlementNames");
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(adapter.descriptor().opacity).toBe(0);
  expect(host.child?.textContent || "").toMatch(/Initialization required/);
  expect(onDraw).toHaveBeenCalled();
  dispose();
});

test("recovering settings removes only the settlement setup alert", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const unrelated = {
    className: "projection-browser-error",
    textContent: "Browser projection unavailable: WebGL context lost",
    removed: false,
    remove() { this.removed = true; },
  };
  const setup = {
    className: "", style: {}, textContent: "", dataset: {}, removed: false,
    setAttribute() {},
    remove() { this.removed = true; host.alerts = host.alerts.filter((node) => node !== setup); },
  };
  const host = {
    alerts: [],
    querySelector(selector) {
      if (selector !== ".projection-browser-error") return null;
      return this.alerts.find((node) => String(node.className).split(/\s+/).includes("projection-browser-error")) || null;
    },
    appendChild(node) { this.alerts.push(node); },
    ownerDocument: { createElement: () => setup },
  };
  const data = contextFor(null);
  data.state.revision = 0;
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, host, getGroups: () => data.state.groups, onDraw: vi.fn(), onError: vi.fn() });
  await vi.waitFor(() => expect(setup.textContent).toMatch(/Initialization required/));
  host.alerts.unshift(unrelated);
  data.state.settings = settingsFixture();
  data.state.revision = 3;
  data.state.error = null;
  data.emit("settlementNames");
  await vi.waitFor(() => expect(adapter.descriptor()?.opacity).toBe(1));
  expect(setup.removed).toBe(true);
  expect(unrelated.removed).toBe(false);
  dispose();
});
