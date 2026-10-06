import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { installProjectionPreviewBridge } from "../../frontend/src/projection/projection-preview-bridge.js";
import { drawAfterMapRender } from "../../frontend/src/projection/projection-span-view.js";
import { rollbackProjectionPreviewApply } from "../../frontend/src/projection/projection-preview-task.js";
import * as previewBridge from "../../frontend/src/projection/projection-preview-bridge.js";

test('calibration preview commands are parent-origin and request guarded and never request physical blackout',async()=>{
  const listeners=new Map(),parent={postMessage:vi.fn()};const win={parent,location:{origin:'http://localhost'},addEventListener:(t,fn)=>listeners.set(t,fn),removeEventListener(){}};
  const setCalibrationView=vi.fn(async enabled=>({ready:enabled,sceneIdentity:enabled?'landmarks':null,missingIds:[]}));
  const dispose=installProjectionPreviewBridge({win,output:'left',map:{},nameFieldController:{},syncContextInvestigation(){},setCalibrationView});
  const send=(requestId,source=parent,origin='http://localhost')=>listeners.get('message')({source,origin,data:{type:'otef_projection_preview_calibration',output:'left',requestId,enabled:true}});
  send(1,{});send(1,parent,'http://bad');expect(setCalibrationView).not.toHaveBeenCalled();send(1);send(0);await flushMicrotasks();
  expect(setCalibrationView).toHaveBeenCalledTimes(1);expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'otef_projection_preview_calibration_rendered',requestId:1,sceneIdentity:'landmarks',ready:true}),'http://localhost');dispose();
});

test('settlement bridge forwards the camera matrix needed for editor dragging', async () => {
  const listeners=new Map(), parent={postMessage:vi.fn()};
  const win={parent,location:{origin:'http://localhost'},addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  const positionMatrix=[2,0,0,1,-300,0];
  const dispose=previewBridge.installProjectionSettlementPreviewBridge({win,sessionId:'settlement-1',output:'left',renderState:async()=>({calibrationRevision:8,meshIdentity:'mesh',mesh:{},labels:[],positionMatrix})});
  listeners.get('message')({source:parent,origin:'http://localhost',data:{type:'otef_settlement_preview_state',sessionId:'settlement-1',output:'left',requestId:1}});
  await vi.waitFor(()=>expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'otef_settlement_preview_rendered',positionMatrix}),'http://localhost'));
  dispose();
});

const clockLayout = { leftPct: 12, topPct: 22, widthPct: 30, heightPct: 10, fontPx: 24, rotateDeg: 30 };
const clockRequest = (requestId, patch = {}) => ({ type: "otef_clock_preview_state", sessionId: "clock-1", requestId,
  surface: "projection", sceneId: "home", output: "left", element: "clock", clockLayout,
  legendLayout: { ...clockLayout, dwellSeconds: 8 }, pageIndex: 0, ...patch });

const flushMicrotasks = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };

test('source notifications bind semantic changes to the current guarded render request', async () => {
  const listeners = new Map(), parent = {postMessage:vi.fn()}, win = {parent,location:{origin:'http://localhost'},
    addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type)=>listeners.delete(type)};
  let notify, finish, source = {sourceFrameIdentity:'source-a',stable:true,error:null};
  const unsub = vi.fn(); const map = {setEffectiveProjectionConfig:()=>true}, nameFieldController = {setProjectionConfig:()=>true};
  const dispose=installProjectionPreviewBridge({win,output:'left',map,nameFieldController,syncContextInvestigation(){},
    readSourceState:()=>source,subscribeSourceState:fn=>{notify=fn;return unsub;},applyProjectionConfig:()=>new Promise(resolve=>{finish=resolve;})});
  const data={type:'otef_projection_preview_config',output:'left',requestId:1,config:DEFAULT_PROJECTION_CONFIG};
  listeners.get('message')({source:win,origin:win.location.origin,data}); expect(parent.postMessage.mock.calls.some(([m])=>m.type==='otef_projection_preview_source_state')).toBe(false);
  listeners.get('message')({source:parent,origin:win.location.origin,data});
  expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'otef_projection_preview_source_state',requestId:1,stable:false}),win.location.origin);
  finish({committed:true}); await flushMicrotasks();
  expect(parent.postMessage.mock.calls.map(([m])=>m)).toContainEqual(expect.objectContaining({type:'otef_projection_preview_source_state',requestId:1,sourceFrameIdentity:'source-a',stable:true}));
  source={sourceFrameIdentity:'source-b',stable:false,error:'labels pending'}; notify();
  expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({requestId:1,sourceFrameIdentity:'source-b',stable:false,error:'labels pending'}),win.location.origin);
  const count=parent.postMessage.mock.calls.length;notify();expect(parent.postMessage).toHaveBeenCalledTimes(count);
  dispose(); expect(unsub).toHaveBeenCalled(); notify();expect(parent.postMessage).toHaveBeenCalledTimes(count);
});

function createActualPreviewApplyHarness({ preparePair } = {}) {
  const source = readFileSync(new URL("../../frontend/src/entries/projection-main.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("applyPreviewProjectionConfig = async");
  const end = source.indexOf("\n    }\n\n    if (previewMode) { previewBridge", start);
  if (start < 0 || end <= start) throw new Error("Could not locate actual projection preview apply route");
  const previous = structuredClone(DEFAULT_PROJECTION_CONFIG);
  let activePair = previous, cameraConfig = previous, namesConfig = previous;
  let rollbackCount = 0;
  const mapListeners = new Map();
  const drawSnapshots = [];
  const map = {
    on(type, listener) { if (!mapListeners.has(type)) mapListeners.set(type, new Set()); mapListeners.get(type).add(listener); },
    off(type, listener) { mapListeners.get(type)?.delete(listener); if (!mapListeners.get(type)?.size) mapListeners.delete(type); },
    triggerRepaint() {},
    emit(type, event = {}) { for (const listener of [...(mapListeners.get(type) || [])]) listener(event); },
    setEffectiveProjectionConfig(config) { cameraConfig = config; return true; },
  };
  const browserSurface = {
    getConfig: () => activePair,
    preparePair: (config, signal) => preparePair ? preparePair(config, signal) : Promise.resolve({ config }),
    commitPair(pair) { pair.previous = activePair; activePair = pair.config; },
    rollbackPair(pair) { rollbackCount++; activePair = pair.previous; },
    draw() { drawSnapshots.push({ pair: activePair, camera: cameraConfig, names: namesConfig }); return true; },
    finalizePair() {},
  };
  const nameFieldController = { applyProjectionConfigGeometry(config) { namesConfig = config; return true; } };
  const dependencies = {
    browserSurface, map, nameFieldController, rollbackProjectionPreviewApply, drawAfterMapRender,
    cancelPreviewNames: async () => {}, startPreviewNames: async () => {},
    browserStartupGate: { ready() {} }, isRuntimeAlive: () => true,
    throwIfPreviewAborted(signal, generation, latest) {
      if (signal?.aborted || generation !== latest()) throw Object.assign(new Error("Preview superseded"), { name: "AbortError" });
    },
  };
  const apply = new Function("deps", `
    const { browserSurface, map, nameFieldController, rollbackProjectionPreviewApply, drawAfterMapRender,
      cancelPreviewNames, startPreviewNames, browserStartupGate, isRuntimeAlive, throwIfPreviewAborted } = deps;
    let previewGeometryAccepted = true, previewNamesInitializationStarted = true;
    let previewApplySequence = 0, projectionMapAlive = true, applyPreviewProjectionConfig;
    ${source.slice(start, end)}
    return applyPreviewProjectionConfig;
  `)(dependencies);
  const messages = [];
  const listeners = new Map();
  const parent = { postMessage: (message) => messages.push(message) };
  const win = { parent, location: { origin: "http://preview.test" },
    addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: (type) => listeners.delete(type) };
  const dispose = installProjectionPreviewBridge({ win, output: "left", map, nameFieldController,
    syncContextInvestigation() {}, applyProjectionConfig: apply });
  const send = (requestId, config) => listeners.get("message")({ source: parent, origin: win.location.origin, data: {
    type: "otef_projection_preview_config", output: "left", requestId, config,
  } });
  return { previous, map, mapListeners, browserSurface, nameFieldController, messages, drawSnapshots,
    get activePair() { return activePair; }, get cameraConfig() { return cameraConfig; }, get namesConfig() { return namesConfig; },
    get rollbackCount() { return rollbackCount; }, send, dispose };
}

test("clock bridge validates parent, session, increasing requests and finite local layouts", async () => {
  expect(previewBridge.installProjectionClockPreviewBridge).toBeTypeOf("function");
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: "http://localhost" }, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type) };
  const renderState = vi.fn(async () => ({ meshIdentity: "mesh-1", mesh: {}, pageIndex: 0, pageCount: 1 }));
  const dispose = previewBridge.installProjectionClockPreviewBridge({ win, sessionId: "clock-1", renderState });
  const send = (data, source = parent, origin = "http://localhost") => listeners.get("message")({ data, source, origin });
  send(clockRequest(1), {}); send(clockRequest(1), parent, "http://other"); send(clockRequest(1, { sessionId: "old" }));
  send(clockRequest(1, { sceneId: "nova" })); send(clockRequest(1, { element: "projection.left" }));
  send(clockRequest(1, { clockLayout: { ...clockLayout, fontPx: NaN } }));
  send(clockRequest(1, { pageIndex: -1 }));
  expect(renderState).not.toHaveBeenCalled();
  send(clockRequest(3)); send(clockRequest(3)); send(clockRequest(2));
  await vi.waitFor(() => expect(renderState).toHaveBeenCalledOnce());
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: "otef_clock_preview_rendered", sessionId: "clock-1", requestId: 3,
    surface: "projection", sceneId: "home", output: "left", meshIdentity: "mesh-1", mesh: {}, pageIndex: 0, pageCount: 1 }, "http://localhost");
  dispose(); expect(listeners.has("message")).toBe(false);
});

test("clock bridge aborts older draws and cannot reply after disposal", async () => {
  expect(previewBridge.installProjectionClockPreviewBridge).toBeTypeOf("function");
  const listeners = new Map(); const parent = { postMessage: vi.fn() }; const pending = [];
  const win = { parent, location: { origin: "http://localhost" }, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type) };
  const dispose = previewBridge.installProjectionClockPreviewBridge({ win, sessionId: "clock-1",
    renderState: (state, context) => new Promise((resolve) => pending.push({ state, context, resolve })) });
  const send = (data) => listeners.get("message")({ data, source: parent, origin: "http://localhost" });
  send(clockRequest(1)); send(clockRequest(2, { element: "legend" }));
  expect(pending[0].context.signal.aborted).toBe(true);
  expect(pending[0].context.isCurrent()).toBe(false);
  pending[0].resolve({}); await Promise.resolve();
  expect(parent.postMessage.mock.calls.filter(([data]) => data.requestId === 1)).toHaveLength(0);
  dispose(); expect(pending[1].context.signal.aborted).toBe(true);
  pending[1].resolve({}); await Promise.resolve();
  expect(parent.postMessage.mock.calls.filter(([data]) => data.type === "otef_clock_preview_rendered")).toHaveLength(0);
});

test("clock bridge accepts legacy and integer columns, rejects malformed values with existing guards", async () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: "http://localhost" }, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener() {} };
  const renderState = vi.fn(async () => ({ meshIdentity: "mesh", mesh: {}, pageIndex: 0, pageCount: 1 }));
  previewBridge.installProjectionClockPreviewBridge({ win, sessionId: "clock-1", renderState });
  const send = (state, source = parent, origin = "http://localhost") => listeners.get("message")({ data: state, source, origin });
  for (const columns of [undefined, 0, 1, 2, 3]) {
    const request = clockRequest(renderState.mock.calls.length + 1, { element: "legend" });
    if (columns !== undefined) request.legendLayout.columns = columns;
    send(request);
  }
  await vi.waitFor(() => expect(renderState).toHaveBeenCalledTimes(5));
  for (const columns of ["2", 1.5, -1, 4, null]) {
    const request = clockRequest(10 + renderState.mock.calls.length, { element: "legend", legendLayout: { ...clockRequest(1).legendLayout, columns } });
    send(request);
  }
  expect(renderState).toHaveBeenCalledTimes(5);
  expect(parent.postMessage.mock.calls.filter(([message]) => message.type === "otef_clock_preview_error")).toHaveLength(5);
  send(clockRequest(30), {}, "http://localhost");
  send(clockRequest(31), parent, "http://other");
  expect(renderState).toHaveBeenCalledTimes(5);
});

test("preview accepts only its same-origin parent and applies a validated draft locally", () => {
  const listeners = new Map();
  const parent = { postMessage: vi.fn() };
  const win = {
    parent, location: { origin: "http://localhost" },
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type) => listeners.delete(type),
  };
  const map = { setEffectiveProjectionConfig: vi.fn(() => true) };
  const names = { setProjectionConfig: vi.fn(() => true) };
  const sync = vi.fn();
  const dispose = installProjectionPreviewBridge({ win, output: "left", map, nameFieldController: names, syncContextInvestigation: sync });
  expect(parent.postMessage).toHaveBeenCalledWith({ type: "otef_projection_preview_ready", output: "left" }, "http://localhost");
  const message = { type: "otef_projection_preview_config", output: "left", requestId: 3, config: structuredClone(DEFAULT_PROJECTION_CONFIG) };
  listeners.get("message")({ source: {}, origin: "http://localhost", data: message });
  listeners.get("message")({ source: parent, origin: "http://other", data: message });
  listeners.get("message")({ source: parent, origin: "http://localhost", data: { ...message, config: { pre: {} } } });
  expect(map.setEffectiveProjectionConfig).not.toHaveBeenCalled();
  listeners.get("message")({ source: parent, origin: "http://localhost", data: message });
  expect(map.setEffectiveProjectionConfig).toHaveBeenCalledWith(message.config);
  expect(names.setProjectionConfig).toHaveBeenCalledWith(message.config);
  expect(sync).toHaveBeenCalledOnce();
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: "otef_projection_preview_applied", output: "left", requestId: 3, success: true }, "http://localhost");
  dispose();
  expect(listeners.has("message")).toBe(false);
});

test("preview ignores a reordered request ID after accepting a newer config", () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: "http://localhost" },
    addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const applyProjectionConfig = vi.fn(() => ({ committed: true }));
  const dispose = installProjectionPreviewBridge({ win, output: "left", map: {}, nameFieldController: {},
    syncContextInvestigation() {}, applyProjectionConfig });
  const send = (requestId) => listeners.get("message")({ source: parent, origin: "http://localhost", data: {
    type: "otef_projection_preview_config", output: "left", requestId, config,
  } });
  send(4); send(3);
  expect(applyProjectionConfig).toHaveBeenCalledOnce();
  expect(parent.postMessage).toHaveBeenLastCalledWith({
    type: "otef_projection_preview_applied", output: "left", requestId: 4, success: true,
  }, "http://localhost");
  dispose();
});

test("preview exposes the candidate apply hook before local camera consumers", () => {
  const listeners = new Map();
  const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: "http://localhost" }, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: () => {} };
  const order = [];
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const dispose = installProjectionPreviewBridge({
    win, output: "right", map: { setEffectiveProjectionConfig: vi.fn(() => { order.push("map"); return true; }) },
    nameFieldController: { setProjectionConfig: vi.fn(() => { order.push("names"); return true; }) },
    syncContextInvestigation: () => order.push("sync"),
    applyProjectionConfig: (candidate) => { expect(candidate).toEqual(config); order.push("warp"); return true; },
  });
  listeners.get("message")({ source: parent, origin: "http://localhost", data: { type: "otef_projection_preview_config", output: "right", requestId: 4, config } });
  expect(order).toEqual(["warp", "map", "names", "sync"]);
  dispose();
});

test('an asynchronous paired preview apply uses the prepared wall and ignores a stale reply', async () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' },
    addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  const pending = [];
  const applyProjectionConfig = vi.fn((_config, context) => new Promise((resolve) => pending.push({ resolve, context })));
  const map = { setEffectiveProjectionConfig: vi.fn() };
  const names = { setProjectionConfig: vi.fn() };
  installProjectionPreviewBridge({ win, output: 'left', map, nameFieldController: names,
    syncContextInvestigation: vi.fn(), applyProjectionConfig });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const send = (requestId) => listeners.get('message')({ source: parent, origin: 'http://localhost', data: {
    type: 'otef_projection_preview_config', output: 'left', requestId, config,
  } });
  send(1); send(2);
  expect(pending[0].context.signal.aborted).toBe(true);
  pending[0].resolve({ committed: true });
  pending[1].resolve({ committed: true });
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenLastCalledWith({
    type: 'otef_projection_preview_applied', output: 'left', requestId: 2, success: true,
  }, 'http://localhost'));
  expect(parent.postMessage.mock.calls.filter(([message]) => message.requestId === 1)).toHaveLength(0);
  expect(map.setEffectiveProjectionConfig).not.toHaveBeenCalled();
  expect(names.setProjectionConfig).not.toHaveBeenCalled();
});

test('the whole geometry apply is bounded and its operation signal aborts on timeout', async () => {
  vi.useFakeTimers();
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' },
    addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  let operationSignal, requestSignal;
  const applyProjectionConfig = vi.fn((_config, context) => {
    operationSignal = context.signal;
    requestSignal = context.requestSignal;
    return new Promise(() => {});
  });
  const dispose = installProjectionPreviewBridge({ win, output: 'left', map: {}, nameFieldController: {},
    syncContextInvestigation: vi.fn(), applyProjectionConfig });
  listeners.get('message')({ source: parent, origin: 'http://localhost', data: {
    type: 'otef_projection_preview_config', output: 'left', requestId: 1, config: structuredClone(DEFAULT_PROJECTION_CONFIG),
  } });
  expect(operationSignal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(30000);
  expect(operationSignal.aborted).toBe(true);
  expect(requestSignal.aborted).toBe(false);
  expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    type: 'otef_projection_preview_applied', output: 'left', requestId: 1, success: false,
  }), 'http://localhost');
  dispose(); vi.useRealTimers();
});

test('the whole names operation is bounded and its operation signal aborts on timeout', async () => {
  vi.useFakeTimers();
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' },
    addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  let operationSignal, requestSignal;
  const applyProjectionConfig = vi.fn((_config, context) => {
    operationSignal = context.signal;
    requestSignal = context.requestSignal;
    return new Promise(() => {});
  });
  const dispose = installProjectionPreviewBridge({ win, output: 'right', map: {}, nameFieldController: {},
    syncContextInvestigation: vi.fn(), applyProjectionConfig });
  listeners.get('message')({ source: parent, origin: 'http://localhost', data: {
    type: 'otef_projection_preview_config', output: 'right', requestId: 2, runNames: true,
    config: structuredClone(DEFAULT_PROJECTION_CONFIG),
  } });
  await vi.advanceTimersByTimeAsync(30000);
  expect(operationSignal.aborted).toBe(true);
  expect(requestSignal.aborted).toBe(false);
  expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    type: 'otef_projection_preview_applied', output: 'right', requestId: 2, success: false,
  }), 'http://localhost');
  dispose(); vi.useRealTimers();
});

test('whole-operation timeout restores the current geometry candidate before its bounded rollback ends', async () => {
  vi.useFakeTimers();
  let resolvePreparation;
  const preparation = new Promise((resolve) => { resolvePreparation = resolve; });
  const route = createActualPreviewApplyHarness({ preparePair: () => preparation });
  const candidate = structuredClone(DEFAULT_PROJECTION_CONFIG); candidate.pre.scale += 0.01;
  route.send(1, candidate);
  await flushMicrotasks();
  await vi.advanceTimersByTimeAsync(29000);
  resolvePreparation({ config: candidate });
  await flushMicrotasks();
  expect(route.activePair).toBe(candidate);
  expect(route.mapListeners.size).toBe(2);

  await vi.advanceTimersByTimeAsync(1000);
  expect(route.rollbackCount).toBe(1);
  expect(route.activePair).toBe(route.previous);
  expect(route.cameraConfig).toBe(route.previous);
  expect(route.namesConfig).toBe(route.previous);
  expect(route.messages.filter((message) => message.type === 'otef_projection_preview_applied')).toContainEqual(
    expect.objectContaining({ requestId: 1, success: false }),
  );
  expect(route.mapListeners.size).toBe(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(route.mapListeners.size).toBe(0);
  expect(route.drawSnapshots).toHaveLength(0);
  route.dispose(); vi.useRealTimers();
});

test('a newer draft retires an actual stalled rollback without drawing or replying for the old request', async () => {
  vi.useFakeTimers();
  const route = createActualPreviewApplyHarness();
  const first = structuredClone(DEFAULT_PROJECTION_CONFIG); first.pre.scale += 0.01;
  const second = structuredClone(DEFAULT_PROJECTION_CONFIG); second.pre.scale += 0.02;
  route.send(1, first);
  await flushMicrotasks();
  route.map.emit('error', { error: new Error('preview render failed') });
  await flushMicrotasks();
  expect(route.rollbackCount).toBe(1);
  expect(route.activePair).toBe(route.previous);
  expect(route.mapListeners.size).toBe(2);

  const repliesBeforeSupersession = route.messages.filter((message) => message.type === 'otef_projection_preview_applied' && message.requestId === 1).length;
  route.send(2, second);
  await flushMicrotasks();
  route.map.emit('render');
  await flushMicrotasks();
  expect(route.activePair).toBe(second);
  expect(route.cameraConfig).toBe(second);
  expect(route.namesConfig).toBe(second);
  expect(route.drawSnapshots).toEqual([{ pair: second, camera: second, names: second }]);
  expect(route.messages.filter((message) => message.type === 'otef_projection_preview_applied' && message.requestId === 1 && message.success)).toHaveLength(0);
  expect(route.messages.filter((message) => message.type === 'otef_projection_preview_applied' && message.requestId === 1)).toHaveLength(repliesBeforeSupersession);
  expect(route.messages).toContainEqual(expect.objectContaining({ type: 'otef_projection_preview_applied', requestId: 2, success: true }));
  expect(route.mapListeners.size).toBe(0);
  route.dispose(); vi.useRealTimers();
});

test('disposing during an actual stalled rollback removes listeners and prevents a late draw or success reply', async () => {
  vi.useFakeTimers();
  const route = createActualPreviewApplyHarness();
  const candidate = structuredClone(DEFAULT_PROJECTION_CONFIG); candidate.pre.scale += 0.01;
  route.send(1, candidate);
  await flushMicrotasks();
  route.map.emit('error', { error: new Error('preview render failed') });
  await flushMicrotasks();
  expect(route.rollbackCount).toBe(1);
  expect(route.activePair).toBe(route.previous);
  expect(route.mapListeners.size).toBe(2);

  const repliesBeforeDispose = route.messages.filter((message) => message.type === 'otef_projection_preview_applied' && message.requestId === 1).length;
  route.dispose();
  await flushMicrotasks();
  expect(route.mapListeners.size).toBe(0);
  await vi.advanceTimersByTimeAsync(5000);
  expect(route.activePair).toBe(route.previous);
  expect(route.drawSnapshots).toHaveLength(0);
  expect(route.messages.filter((message) => message.type === 'otef_projection_preview_applied' && message.requestId === 1 && message.success)).toHaveLength(0);
  expect(route.messages.filter((message) => message.type === 'otef_projection_preview_applied' && message.requestId === 1)).toHaveLength(repliesBeforeDispose);
  vi.useRealTimers();
});

test('disposing while actual pair preparation is pending prevents commit, rollback, draw and Applied reply', async () => {
  vi.useFakeTimers();
  let resolvePreparation;
  const preparation = new Promise((resolve) => { resolvePreparation = resolve; });
  const route = createActualPreviewApplyHarness({ preparePair: () => preparation });
  const candidate = structuredClone(DEFAULT_PROJECTION_CONFIG); candidate.pre.scale += 0.01;
  route.send(1, candidate);
  await flushMicrotasks();
  route.dispose();
  resolvePreparation({ config: candidate });
  await flushMicrotasks();
  expect(route.activePair).toBe(route.previous);
  expect(route.cameraConfig).toBe(route.previous);
  expect(route.namesConfig).toBe(route.previous);
  expect(route.rollbackCount).toBe(0);
  expect(route.drawSnapshots).toHaveLength(0);
  expect(route.messages.filter((message) => message.type === 'otef_projection_preview_applied')).toHaveLength(0);
  expect(route.mapListeners.size).toBe(0);
  vi.useRealTimers();
});

test('explicit Run names is passed through the unchanged preview applied handshake', async () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' },
    addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const applyProjectionConfig = vi.fn(async () => ({ committed: true }));
  installProjectionPreviewBridge({ win, output: 'right', map: {}, nameFieldController: {},
    syncContextInvestigation() {}, applyProjectionConfig });
  listeners.get('message')({ source: parent, origin: 'http://localhost', data: {
    type: 'otef_projection_preview_config', output: 'right', requestId: 7, runNames: true, config,
  } });
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenLastCalledWith({
    type: 'otef_projection_preview_applied', output: 'right', requestId: 7, success: true,
  }, 'http://localhost'));
  expect(applyProjectionConfig).toHaveBeenCalledWith(config, expect.objectContaining({ runNames: true, signal: expect.any(AbortSignal) }));
});

test('new geometry cancels an independent names run before starting its apply', () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' },
    addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  const calls = [];
  const applyProjectionConfig = vi.fn((_config, context) => { calls.push(context); return { committed: true }; });
  installProjectionPreviewBridge({ win, output: 'left', map: {}, nameFieldController: {}, syncContextInvestigation() {}, applyProjectionConfig });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const send = (requestId, runNames) => listeners.get('message')({ source: parent, origin: 'http://localhost', data: {
    type: 'otef_projection_preview_config', output: 'left', requestId, runNames, config,
  } });
  send(1, true);
  const namesSignal = calls[0].signal;
  send(2, false);
  expect(namesSignal.aborted).toBe(true);
  expect(calls[1]).toMatchObject({ runNames: false });
  expect(calls[1].signal.aborted).toBe(false);
});

test('preview validation replies with exact identity and complete wall without applying the renderer', async () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' }, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const wall = { datasetVersion: 'release', mode: 'wall', digest: 'a'.repeat(64), expected: 1228, placed: 1228, heading: config.namesWall.rotateDeg };
  const { heading: _heading, ...safeWall } = wall;
  const map = { setEffectiveProjectionConfig: vi.fn() };
  const validateWall = vi.fn(async () => wall);
  installProjectionPreviewBridge({ win, output: 'left', map, nameFieldController: {}, syncContextInvestigation() {}, validateWall });
  listeners.get('message')({ source: parent, origin: 'http://localhost', data: { type: 'otef_projection_preview_validate', output: 'left', requestId: 2, identity: JSON.stringify(config), config } });
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'otef_projection_preview_validated', output: 'left', requestId: 2, identity: JSON.stringify(config), valid: true, wall: safeWall }, 'http://localhost'));
  expect(map.setEffectiveProjectionConfig).not.toHaveBeenCalled();
  expect(validateWall).toHaveBeenCalledWith(config, expect.any(Object));
});

test('preview validation rejects a complete wall whose heading is missing or non-finite', async () => {
  for (const heading of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const listeners = new Map(); const parent = { postMessage: vi.fn() };
    const win = { parent, location: { origin: 'http://localhost' }, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    const wall = { datasetVersion: 'release', mode: 'wall', digest: 'a'.repeat(64), expected: 1228, placed: 1228 };
    if (heading !== undefined) wall.heading = heading;
    installProjectionPreviewBridge({ win, output: 'left', map: {}, nameFieldController: {}, syncContextInvestigation() {},
      validateWall: async () => wall });
    const identity = JSON.stringify(config);
    listeners.get('message')({ source: parent, origin: 'http://localhost', data: { type: 'otef_projection_preview_validate', output: 'left', requestId: 4, identity, config } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenLastCalledWith({
      type: 'otef_projection_preview_validated', output: 'left', requestId: 4, identity, valid: false,
      error: expect.stringMatching(/heading/i),
    }, 'http://localhost'));
  }
});

test('preview validation rejects a wall whose heading disagrees with the candidate rotation', async () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' }, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.namesWall.rotateDeg = 70;
  const wall = { datasetVersion: 'release', mode: 'wall', digest: 'a'.repeat(64), expected: 1228, placed: 1228, heading: 35 };
  installProjectionPreviewBridge({ win, output: 'left', map: {}, nameFieldController: {}, syncContextInvestigation() {},
    validateWall: async () => wall });
  const identity = JSON.stringify(config);
  listeners.get('message')({ source: parent, origin: 'http://localhost', data: { type: 'otef_projection_preview_validate', output: 'left', requestId: 3, identity, config } });
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenLastCalledWith({
    type: 'otef_projection_preview_validated', output: 'left', requestId: 3, identity, valid: false,
    error: expect.stringMatching(/heading/i),
  }, 'http://localhost'));
});

test('preview validation preserves bounded diagnostics for an incomplete candidate without marking it valid', async () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' }, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const diagnostics = { state: 'invalid', datasetVersion: 'nli-1', mode: 'model', requestedFontPx: 6, effectiveFontPx: null, expected: 1228, placed: 1201, left: 600, right: 601, reason: 'capacity through 1px' };
  installProjectionPreviewBridge({ win, output: 'right', map: {}, nameFieldController: {}, syncContextInvestigation() {},
    validateWall: async () => ({ ...diagnostics, heading: config.namesWall.rotateDeg }) });
  const identity = JSON.stringify(config);
  listeners.get('message')({ source: parent, origin: 'http://localhost', data: { type: 'otef_projection_preview_validate', output: 'right', requestId: 9, identity, config } });
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'otef_projection_preview_validated', output: 'right', requestId: 9, identity, valid: false, diagnostics, error: 'capacity through 1px' }, 'http://localhost'));
});
