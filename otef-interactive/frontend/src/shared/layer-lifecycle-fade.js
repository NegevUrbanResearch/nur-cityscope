import { resolveMotionMode } from "./reduced-motion.js";
import {
  emitOpacityMix,
  interpolateOpacityLeaves,
  opacityChannelsForLayerType,
  paintWithOpacityFactor,
  scaleOpacityExpression,
} from "./layer-opacity-expression.js";

export const LAYER_FADE_MS = 600;
export const LAYER_FADE_READY_TIMEOUT_MS = 1200;

/**
 * Reduced motion, retainDisabled, and stageHidden win, in that order.
 * A finite numeric explicit duration is clamped at 0.
 * Nonfinite and nonnumeric explicit values fall through to 600.
 * @param {{ lifecycle?: { retainDisabled?: boolean }, transition?: { stageHidden?: boolean, transitionMs?: unknown } }} [layerStyleOptions]
 * @param {"full"|"reduced"} [motionMode]
 */
export function resolveLayerFadeMs(layerStyleOptions, motionMode = resolveMotionMode()) {
  if (motionMode === "reduced") return 0;
  if (layerStyleOptions?.lifecycle?.retainDisabled === true) return 0;
  if (layerStyleOptions?.transition?.stageHidden === true) return 0;
  const raw = layerStyleOptions?.transition?.transitionMs;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, raw);
  return LAYER_FADE_MS;
}

function defaultNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

const runtimes = new WeakMap();
const hooksByMap = new WeakMap();
const rememberedListeners = new WeakMap();
const rememberedRemoveHandlers = new WeakMap();
const paintWriteObservers = new WeakMap();
const paintWriteRemoveHandlers = new WeakMap();
const removalDiscards = new WeakMap();
const runtimeRemoveHandlers = new WeakMap();

function goalsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Map-keyed replay hook. Independent of clock hooks and runtime instances.
 * `null` clears the attachment. Ordinary dispose keeps it; map removal clears it.
 * @param {object} map
 * @param {((event: { fullId: string, channels: Array<{ layerId: string, property: string, type: string }> }) => void)|null} listener
 */
export function setPaintChannelsRememberedListener(map, listener) {
  if (!map) return;
  const previous = rememberedRemoveHandlers.get(map);
  if (previous && typeof map.off === "function") map.off("remove", previous);
  rememberedRemoveHandlers.delete(map);
  if (typeof listener !== "function") {
    rememberedListeners.delete(map);
    return;
  }
  rememberedListeners.set(map, listener);
  if (typeof map.on !== "function") return;
  const onRemove = () => {
    rememberedListeners.delete(map);
    rememberedRemoveHandlers.delete(map);
    paintWriteObservers.delete(map);
    const paintRemove = paintWriteRemoveHandlers.get(map);
    if (paintRemove && typeof map.off === "function") map.off("remove", paintRemove);
    paintWriteRemoveHandlers.delete(map);
    if (typeof map.off === "function") map.off("remove", onRemove);
    const discard = removalDiscards.get(map);
    if (typeof discard === "function") discard();
  };
  rememberedRemoveHandlers.set(map, onRemove);
  map.on("remove", onRemove);
}

/**
 * Observe every lifecycle paint write, including before addLayer.
 * Independent of clock hooks. Map removal drops the set.
 * @param {object} map
 * @param {(event: { fullId: string, layerId: string, property: string, value: unknown, factor: number }) => void} listener
 * @returns {() => void}
 */
export function addPaintWriteObserver(map, listener) {
  if (!map || typeof listener !== "function") return () => {};
  let observers = paintWriteObservers.get(map);
  if (!observers) {
    observers = new Set();
    paintWriteObservers.set(map, observers);
  }
  observers.add(listener);
  if (typeof map.on === "function" && !paintWriteRemoveHandlers.has(map)) {
    const onRemove = () => {
      paintWriteObservers.delete(map);
      paintWriteRemoveHandlers.delete(map);
      if (typeof map.off === "function") map.off("remove", onRemove);
    };
    paintWriteRemoveHandlers.set(map, onRemove);
    map.on("remove", onRemove);
  }
  return () => {
    observers.delete(listener);
    if (observers.size === 0) {
      paintWriteObservers.delete(map);
      const onRemove = paintWriteRemoveHandlers.get(map);
      if (onRemove && typeof map.off === "function") map.off("remove", onRemove);
      paintWriteRemoveHandlers.delete(map);
    }
  };
}

function notifyPaintWrite(map, event) {
  const observers = paintWriteObservers.get(map);
  if (!observers) return;
  for (const listener of observers) listener(event);
}

function hasClockHooks(hooks) {
  return Boolean(
    hooks
    && (typeof hooks.now === "function"
      || typeof hooks.requestFrame === "function"
      || typeof hooks.cancelFrame === "function"
      || typeof hooks.setTimer === "function"
      || typeof hooks.clearTimer === "function"),
  );
}

function normalizeIds(fullIds) {
  const ids = Array.isArray(fullIds) ? fullIds : [];
  return new Set(ids.filter((id) => id != null && String(id) !== "").map((id) => String(id)));
}

function createMember(fullId) {
  return {
    fullId,
    channels: [],
    onTeardown: null,
    onFrameDraw: null,
    unsubscribers: [],
    ready: false,
    failed: false,
    invalidated: false,
    staged: false,
    revealed: false,
    tornDown: false,
    factor: 0,
    trajectory: null,
    requestToken: null,
  };
}

/**
 * Per-map lifecycle fade. One pending batch and one frame callback while fades run.
 * `stageMapLayer` / `registerElement` join the pending batch.
 * @param {object} map
 * @param {{ now?: () => number, requestFrame?: Function, cancelFrame?: Function, setTimer?: Function, clearTimer?: Function }} [hooks]
 */
export function getLayerLifecycleRuntime(map, hooks = {}) {
  if (!map) return null;
  if (hasClockHooks(hooks)) hooksByMap.set(map, hooks);
  const existing = runtimes.get(map);
  if (existing && !existing.isDisposed()) return existing;
  const runtime = createLayerLifecycleRuntime(map, hooksByMap.get(map) || hooks);
  runtimes.set(map, runtime);
  return runtime;
}

/** Live runtime for this map, or null. Does not create one or bind clock hooks. */
export function peekLayerLifecycleRuntime(map) {
  if (!map) return null;
  const existing = runtimes.get(map);
  if (existing && !existing.isDisposed()) return existing;
  return null;
}

function createLayerLifecycleRuntime(map, hooks) {
  const now = typeof hooks.now === "function" ? hooks.now : defaultNow;
  const requestFrame = hooks.requestFrame
    || (typeof requestAnimationFrame === "function" ? (callback) => requestAnimationFrame(callback) : (callback) => setTimeout(() => callback(now()), 16));
  const cancelFrame = hooks.cancelFrame
    || (typeof cancelAnimationFrame === "function" ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id));
  const setTimer = hooks.setTimer || ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = hooks.clearTimer || ((id) => clearTimeout(id));

  const members = new Map();
  let desired = new Set();
  let pending = null;
  let durationMs = LAYER_FADE_MS;
  let serial = 0;
  let batchSerial = 0;
  let frameHandle = null;
  let frameQueued = false;
  let deadlineId = null;
  let disposed = false;

  function ensureMember(fullId) {
    const id = String(fullId);
    let member = members.get(id);
    if (!member) {
      member = createMember(id);
      members.set(id, member);
    }
    return member;
  }

  function unsubscribe(member) {
    const list = member.unsubscribers.splice(0, member.unsubscribers.length);
    for (const unsub of list) {
      if (typeof unsub === "function") unsub();
    }
  }

  function bindCallbacks(member, bindings) {
    if (!member.onTeardown && typeof bindings?.onTeardown === "function") member.onTeardown = bindings.onTeardown;
    if (!member.onFrameDraw && typeof bindings?.onFrameDraw === "function") member.onFrameDraw = bindings.onFrameDraw;
  }

  function subscribeReady(member, bindings) {
    unsubscribe(member);
    if (typeof bindings?.subscribeReady !== "function") return;
    const unsubscribeReady = bindings.subscribeReady({
      ready: () => markMemberReady(member.fullId),
      failed: () => markMemberFailed(member.fullId),
    });
    if (typeof unsubscribeReady === "function") member.unsubscribers.push(unsubscribeReady);
  }

  function addMembership(fullId) {
    if (!pending || pending.membership.includes(fullId)) return;
    pending.membership.push(fullId);
  }

  function removeMembership(fullId) {
    if (!pending) return;
    pending.membership = pending.membership.filter((id) => id !== fullId);
  }

  function clearDeadline() {
    if (deadlineId == null) return;
    clearTimer(deadlineId);
    deadlineId = null;
  }

  function armDeadline() {
    clearDeadline();
    if (!pending || pending.durationMs <= 0) return;
    deadlineId = setTimer(() => {
      deadlineId = null;
      if (!pending || disposed) return;
      pending.timedOut = true;
      pending.sealed = true;
      tryFinishBatch();
    }, LAYER_FADE_READY_TIMEOUT_MS);
  }

  function sampleFactor(member, time) {
    const traj = member.trajectory;
    if (!traj) return member.factor;
    if (traj.duration <= 0) return traj.to;
    const progress = Math.min(1, Math.max(0, (time - traj.start) / traj.duration));
    return traj.from + (traj.to - traj.from) * progress;
  }

  function hasEffectiveOverride(channel) {
    return Object.prototype.hasOwnProperty.call(channel, "effective");
  }

  function channelBase(channel) {
    if (hasEffectiveOverride(channel)) return channel.effective;
    return channel.base;
  }

  function commitEffectiveGoal(channel, value) {
    channel.goal = value;
    channel.effective = value;
    channel.effectiveLeaves = [{ value, weight: 1 }];
    channel.effectiveTween = null;
  }

  function clearMemberTweens(member) {
    for (const channel of member.channels) channel.effectiveTween = null;
  }

  function memberHasLiveEffective(member) {
    if (!member || member.tornDown || member.invalidated) return false;
    for (const channel of member.channels) {
      if (channel.effectiveTween && channel.effectiveTween.duration > 0) return true;
    }
    return false;
  }

  function tweenProgress(tween, time) {
    if (!(tween.duration > 0)) return 1;
    return Math.min(1, Math.max(0, (time - tween.start) / tween.duration));
  }

  function leavesOf(channel) {
    if (Array.isArray(channel.effectiveLeaves) && channel.effectiveLeaves.length > 0) {
      return channel.effectiveLeaves.map((leaf) => ({ value: leaf.value, weight: leaf.weight }));
    }
    const value = hasEffectiveOverride(channel) ? channel.effective : channel.base;
    return [{ value, weight: 1 }];
  }

  function sampleEffectiveLeaves(channel, time) {
    const tween = channel.effectiveTween;
    if (!tween) return leavesOf(channel);
    return interpolateOpacityLeaves(tween.fromLeaves, tween.to, tweenProgress(tween, time));
  }

  function sampleMemberEffective(member, time) {
    for (const channel of member.channels) {
      const tween = channel.effectiveTween;
      if (!tween) continue;
      const progress = tweenProgress(tween, time);
      if (progress >= 1) {
        commitEffectiveGoal(channel, tween.to);
        continue;
      }
      const leaves = interpolateOpacityLeaves(tween.fromLeaves, tween.to, progress);
      channel.effectiveLeaves = leaves;
      channel.effective = emitOpacityMix(leaves);
    }
  }

  function settleMemberEffective(member) {
    for (const channel of member.channels) {
      if (!channel.effectiveTween) continue;
      commitEffectiveGoal(channel, channel.effectiveTween.to);
    }
  }

  function writePaint(member, channel, factor, restore) {
    const transitionKey = `${channel.property}-transition`;
    const restoreAuthored = restore && !hasEffectiveOverride(channel);
    const value = restoreAuthored
      ? (channel.present ? channel.authored : 1)
      : scaleOpacityExpression(channelBase(channel), factor);
    notifyPaintWrite(map, {
      fullId: member.fullId,
      layerId: channel.layerId,
      property: channel.property,
      value,
      factor,
    });
    if (typeof map.getLayer === "function" && !map.getLayer(channel.layerId)) return;
    if (typeof map.setPaintProperty !== "function") return;
    if (restoreAuthored) {
      map.setPaintProperty(channel.layerId, transitionKey, { duration: 0, delay: 0 });
      if (channel.present) {
        map.setPaintProperty(channel.layerId, channel.property, channel.authored);
      } else {
        map.setPaintProperty(channel.layerId, channel.property, undefined);
      }
      map.setPaintProperty(
        channel.layerId,
        transitionKey,
        channel.transitionPresent ? channel.transition : undefined,
      );
      return;
    }
    map.setPaintProperty(channel.layerId, transitionKey, { duration: 0, delay: 0 });
    map.setPaintProperty(channel.layerId, channel.property, value);
  }

  function writeDom(channel, factor) {
    const value = scaleOpacityExpression(channelBase(channel), factor);
    channel.element.style.transition = "none";
    channel.element.style.opacity = String(value);
  }

  function writeMember(member, factor, restore) {
    for (const channel of member.channels) {
      if (channel.kind === "dom") writeDom(channel, factor);
      else writePaint(member, channel, factor, restore);
    }
  }

  function teardown(member) {
    if (!member || member.tornDown) return;
    if (desired.has(member.fullId) && !member.invalidated) return;
    member.tornDown = true;
    member.trajectory = null;
    clearMemberTweens(member);
    unsubscribe(member);
    if (typeof member.onTeardown === "function") member.onTeardown();
  }

  function dropInvalidatedTrajectory(member) {
    if (!member?.trajectory) return;
    member.trajectory = null;
    if (member.revealed || member.tornDown) return;
    member.factor = 0;
    writeMember(member, 0, false);
    teardown(member);
  }

  function cancelIdleFrame() {
    if (hasActiveFade() || frameHandle == null) return;
    cancelFrame(frameHandle);
    frameHandle = null;
    frameQueued = false;
  }

  function hasActiveFade() {
    for (const member of members.values()) {
      if (member.tornDown || member.invalidated) continue;
      const traj = member.trajectory;
      if (traj && traj.duration > 0 && traj.from !== traj.to) return true;
      if (memberHasLiveEffective(member)) return true;
    }
    return false;
  }

  function ensureFrame() {
    if (disposed || frameQueued || !hasActiveFade()) return;
    frameQueued = true;
    frameHandle = requestFrame(() => {
      frameQueued = false;
      frameHandle = null;
      if (disposed) return;
      step(now());
      ensureFrame();
    });
  }

  function step(time) {
    for (const member of [...members.values()]) {
      if (member.invalidated) {
        clearMemberTweens(member);
        dropInvalidatedTrajectory(member);
        continue;
      }
      if (member.tornDown) continue;
      const traj = member.trajectory;
      if (!traj && !memberHasLiveEffective(member)) continue;
      let factorDone = false;
      if (traj) {
        factorDone = traj.duration <= 0 || time >= traj.start + traj.duration;
        member.factor = factorDone ? traj.to : sampleFactor(member, time);
        if (factorDone) member.trajectory = null;
      }
      sampleMemberEffective(member, time);
      writeMember(member, member.factor, factorDone && member.factor === 1);
      if (typeof member.onFrameDraw === "function") member.onFrameDraw();
      if (factorDone && member.factor === 1) member.revealed = true;
      if (factorDone && member.factor === 0) {
        clearMemberTweens(member);
        teardown(member);
      }
    }
  }

  function beginTrajectory(member, from, to, duration, time) {
    member.factor = from;
    if (duration <= 0 || from === to) {
      member.trajectory = null;
      member.factor = to;
      if (duration <= 0) settleMemberEffective(member);
      else sampleMemberEffective(member, time);
      if (to === 1) {
        member.revealed = true;
        writeMember(member, 1, true);
        if (duration > 0 && memberHasLiveEffective(member)) ensureFrame();
      } else {
        member.revealed = false;
        writeMember(member, 0, false);
        teardown(member);
      }
      return;
    }
    member.revealed = false;
    member.trajectory = { from, to, start: time, duration };
    writeMember(member, from, false);
    ensureFrame();
  }

  function hiddenPreparing(member) {
    return member.staged && !member.revealed && !member.trajectory && member.factor === 0 && !member.tornDown;
  }

  function beginBatch(nextDuration = durationMs) {
    if (disposed) return null;
    clearDeadline();
    const createdAt = now();
    const duration = typeof nextDuration === "number" && Number.isFinite(nextDuration)
      ? Math.max(0, nextDuration)
      : durationMs;
    durationMs = duration;
    pending = {
      id: ++batchSerial,
      createdAt,
      deadlineAt: createdAt + LAYER_FADE_READY_TIMEOUT_MS,
      durationMs: duration,
      membership: [],
      sealed: false,
      timedOut: false,
    };
    for (const [id, member] of members) {
      if (desired.has(id) && hiddenPreparing(member) && !member.invalidated) addMembership(id);
    }
    armDeadline();
    return pending;
  }

  function settleUnchangedTrajectories() {
    const time = now();
    for (const [id, member] of members) {
      const traj = member.trajectory;
      if (!traj || member.tornDown || member.invalidated) continue;
      beginTrajectory(member, member.factor, desired.has(id) ? 1 : 0, 0, time);
    }
    cancelIdleFrame();
  }

  function startTrajectories(batch) {
    const time = now();
    const incoming = new Set(batch.membership);
    const preserve = batch.durationMs > 0;
    for (const id of desired) {
      const member = members.get(id);
      if (!member || !member.staged || member.tornDown || member.invalidated || member.failed) continue;
      const waiting = incoming.has(id) && !member.ready;
      if (waiting && preserve) continue;
      if (preserve && member.trajectory && member.trajectory.to === 1) continue;
      beginTrajectory(member, sampleFactor(member, time), 1, batch.durationMs, time);
    }
    for (const [id, member] of members) {
      if (desired.has(id) || member.tornDown || !member.staged) continue;
      if (member.invalidated && member.factor === 0 && !member.revealed) continue;
      if (preserve && member.trajectory && member.trajectory.to === 0) continue;
      beginTrajectory(member, sampleFactor(member, time), 0, batch.durationMs, time);
    }
    if (!preserve) cancelIdleFrame();
  }

  function finishBatch(batch) {
    clearDeadline();
    for (const id of batch.membership) {
      const member = members.get(id);
      if (!member) continue;
      if (member.ready || member.failed || !desired.has(id)) unsubscribe(member);
    }
    if (pending === batch) pending = null;
  }

  function tryFinishBatch() {
    if (!pending || !pending.sealed) return;
    const waiting = pending.membership.filter((id) => {
      const member = members.get(id);
      if (!member || member.invalidated || member.tornDown || member.failed || member.ready) return false;
      return desired.has(id);
    });
    if (waiting.length > 0 && !pending.timedOut && pending.durationMs > 0) return;
    const batch = pending;
    startTrajectories(batch);
    finishBatch(batch);
  }

  function dropDesired(fullId) {
    const member = members.get(fullId);
    if (!member) return;
    member.requestToken = ++serial;
    removeMembership(fullId);
    if (hiddenPreparing(member) || !member.staged) {
      member.invalidated = true;
      unsubscribe(member);
      teardown(member);
    }
  }

  function settleMountedEffective(discardInvalidated) {
    const time = now();
    for (const member of members.values()) {
      if (member.invalidated || member.tornDown) {
        if (discardInvalidated) {
          member.trajectory = null;
          clearMemberTweens(member);
        }
        continue;
      }
      let settled = false;
      for (const channel of member.channels) {
        if (!channel.effectiveTween) continue;
        commitEffectiveGoal(channel, channel.effectiveTween.to);
        settled = true;
      }
      if (!settled) continue;
      const factor = sampleFactor(member, time);
      member.factor = factor;
      writeMember(member, factor, factor === 1 && !member.trajectory);
    }
    cancelIdleFrame();
  }

  function setDesiredIds(fullIds, options = {}) {
    if (disposed) return null;
    const next = normalizeIds(fullIds);
    const explicitZero = typeof options.durationMs === "number"
      && Number.isFinite(options.durationMs)
      && options.durationMs <= 0;
    if (options.sameSet === true) {
      desired = next;
      if (explicitZero) {
        durationMs = 0;
        if (pending) pending.durationMs = 0;
        settleMountedEffective(false);
        settleUnchangedTrajectories();
      }
      return pending;
    }
    if (typeof options.durationMs === "number" && Number.isFinite(options.durationMs)) {
      durationMs = Math.max(0, options.durationMs);
    }
    const previous = desired;
    desired = next;
    beginBatch(durationMs);
    for (const id of previous) {
      if (!next.has(id)) dropDesired(id);
    }
    if (durationMs <= 0) {
      settleMountedEffective(false);
      settleUnchangedTrajectories();
    }
    return pending;
  }

  function stagedPaint(member, layerType, paint, factor, mountAtZero, layerId) {
    const nextPaint = {
      ...(paintWithOpacityFactor(layerType, paint, mountAtZero ? 0 : factor) || {}),
    };
    for (const channel of member.channels) {
      if (channel.kind !== "paint" || channel.layerId !== layerId || !hasEffectiveOverride(channel)) continue;
      nextPaint[channel.property] = scaleOpacityExpression(channel.effective, mountAtZero ? 0 : factor);
      nextPaint[`${channel.property}-transition`] = { duration: 0, delay: 0 };
    }
    if (mountAtZero || factor !== 1) {
      for (const property of opacityChannelsForLayerType(layerType)) {
        nextPaint[`${property}-transition`] = { duration: 0, delay: 0 };
      }
    }
    const emitFactor = mountAtZero ? 0 : factor;
    for (const channel of member.channels) {
      if (channel.kind !== "paint" || channel.layerId !== layerId) continue;
      const painted = nextPaint[channel.property];
      if (painted === undefined) continue;
      notifyPaintWrite(map, {
        fullId: member.fullId,
        layerId,
        property: channel.property,
        value: painted,
        factor: emitFactor,
      });
    }
    return nextPaint;
  }

  function rememberPaintChannels(member, layerDef) {
    const paint = layerDef?.paint || {};
    const layerId = layerDef?.id;
    member.channels = member.channels.filter((channel) => channel.kind === "dom" || channel.layerId !== layerId);
    for (const property of opacityChannelsForLayerType(layerDef?.type)) {
      const present = Object.prototype.hasOwnProperty.call(paint, property);
      const transitionKey = `${property}-transition`;
      const transitionPresent = Object.prototype.hasOwnProperty.call(paint, transitionKey);
      const channel = {
        kind: "paint",
        layerId,
        property,
        present,
        base: present ? paint[property] : 1,
        transitionPresent,
      };
      if (present) channel.authored = paint[property];
      if (transitionPresent) channel.transition = paint[transitionKey];
      member.channels.push(channel);
    }
    const listener = rememberedListeners.get(map);
    if (typeof listener === "function") {
      const channels = [];
      for (const channel of member.channels) {
        if (channel.kind !== "paint" || channel.layerId !== layerId) continue;
        channels.push({ layerId: channel.layerId, property: channel.property, type: layerDef?.type });
      }
      listener({ fullId: member.fullId, channels });
    }
    cancelIdleFrame();
  }

  function stageMapLayer(fullId, layerDef, bindings = {}) {
    if (disposed) return { stagedLayerDef: layerDef };
    const member = ensureMember(fullId);
    member.staged = true;
    member.tornDown = false;
    member.failed = false;
    if (desired.has(member.fullId)) member.invalidated = false;
    bindCallbacks(member, bindings);
    const adoptVisible = bindings.adoptVisible === true;
    if (adoptVisible && !member.trajectory) {
      member.factor = 1;
      member.revealed = true;
      member.ready = true;
    }
    const atZero = desired.has(member.fullId) && !member.revealed && !member.trajectory && member.factor === 0;
    rememberPaintChannels(member, layerDef);
    if (pending && (atZero || (adoptVisible && desired.has(member.fullId)))) addMembership(member.fullId);
    subscribeReady(member, bindings);
    if (adoptVisible) return { stagedLayerDef: layerDef };
    return {
      stagedLayerDef: {
        ...layerDef,
        paint: stagedPaint(member, layerDef?.type, layerDef?.paint, member.factor, atZero, layerDef?.id),
      },
    };
  }

  function registerElement(fullId, element, bindings = {}) {
    if (disposed || !element) return;
    const member = ensureMember(fullId);
    const wasFailed = member.failed;
    member.staged = true;
    member.tornDown = false;
    member.failed = false;
    bindCallbacks(member, bindings);
    const raw = element.style ? element.style.opacity : "";
    const present = raw != null && raw !== "";
    const numeric = present ? Number(raw) : 1;
    const sampled = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 1;
    if (desired.has(member.fullId) || bindings.adoptVisible === true) member.invalidated = false;
    const existing = member.channels.find((channel) => channel.kind === "dom" && channel.element === element);
    if (existing) {
      const holdForReady = bindings.adoptVisible !== true
        && (!member.ready || wasFailed)
        && desired.has(member.fullId);
      if (holdForReady) {
        member.ready = false;
        member.revealed = false;
        member.factor = 0;
        member.trajectory = null;
        element.style.transition = "none";
        element.style.opacity = "0";
        if (pending) addMembership(member.fullId);
        unsubscribe(member);
        subscribeReady(member, bindings);
      }
      return;
    }
    if (bindings.adoptVisible === true && !member.trajectory) {
      member.factor = sampled;
      member.revealed = sampled >= 1;
      member.ready = true;
    }
    const base = bindings.adoptVisible === true || !present || !Number.isFinite(numeric) || numeric <= 0
      ? 1
      : numeric;
    const atZero = bindings.adoptVisible !== true
      && desired.has(member.fullId)
      && !member.revealed
      && !member.trajectory
      && member.factor === 0;
    const channel = {
      kind: "dom",
      element,
      present,
      base,
    };
    member.channels.push(channel);
    if (atZero) {
      element.style.transition = "none";
      element.style.opacity = "0";
      if (pending) addMembership(member.fullId);
    } else {
      const factor = sampleFactor(member, now());
      member.factor = factor;
      writeDom(channel, factor);
    }
    subscribeReady(member, bindings);
  }

  function markMemberReady(fullId) {
    const member = members.get(String(fullId));
    if (!member || member.invalidated || member.tornDown || member.failed || !desired.has(member.fullId)) return;
    if (member.trajectory?.to === 1 || (member.ready && member.revealed)) return;
    member.ready = true;
    if (pending && pending.membership.includes(member.fullId)) {
      tryFinishBatch();
      return;
    }
    if (!pending && !member.revealed) {
      unsubscribe(member);
      beginTrajectory(member, sampleFactor(member, now()), 1, durationMs, now());
    }
  }

  function markMemberFailed(fullId) {
    const member = members.get(String(fullId));
    if (!member || member.invalidated || member.tornDown) return;
    member.failed = true;
    member.ready = false;
    if (pending) tryFinishBatch();
  }

  function subscribeMemberReady(fullId, subscribe) {
    if (disposed || typeof subscribe !== "function") return;
    const member = ensureMember(fullId);
    subscribeReady(member, { subscribeReady: subscribe });
  }

  function invalidateMember(fullId) {
    const member = members.get(String(fullId));
    if (!member) return;
    member.invalidated = true;
    member.requestToken = ++serial;
    removeMembership(member.fullId);
    clearMemberTweens(member);
    tryFinishBatch();
    unsubscribe(member);
    dropInvalidatedTrajectory(member);
    if (hiddenPreparing(member) || !member.revealed) teardown(member);
    cancelIdleFrame();
  }

  function dropChannels(fullId) {
    const member = members.get(String(fullId));
    if (!member) return;
    member.channels = [];
    cancelIdleFrame();
  }

  function readAuthoredOpacity(fullId, property) {
    const member = members.get(String(fullId));
    if (!member) return undefined;
    const channel = member.channels.find((entry) => entry.kind === "paint" && entry.property === property);
    if (!channel || !channel.present) return undefined;
    return channel.authored;
  }

  function hasPaintChannel(fullId, property) {
    const member = members.get(String(fullId));
    if (!member) return false;
    return member.channels.some((entry) => entry.kind === "paint" && entry.property === property);
  }

  function updateEffectiveOpacity(fullId, property, value) {
    const member = members.get(String(fullId));
    if (!member) return;
    const channel = member.channels.find((entry) => entry.property === property);
    if (!channel) return;
    commitEffectiveGoal(channel, value);
    writeMember(member, member.factor, member.factor === 1 && !member.trajectory);
    cancelIdleFrame();
  }

  function findLivePaintChannel(fullId, layerId, property) {
    const member = members.get(String(fullId));
    if (!member || member.invalidated || member.tornDown) return null;
    const channel = member.channels.find((entry) =>
      entry.kind === "paint" && entry.layerId === layerId && entry.property === property);
    if (!channel) return null;
    return { member, channel };
  }

  function updateEffectivePaint(fullId, layerId, property, value, options = {}) {
    if (disposed) return false;
    const found = findLivePaintChannel(fullId, layerId, property);
    if (!found) return false;
    const { member, channel } = found;
    const tweenMs = options.tweenMs;
    const reduced = resolveMotionMode() === "reduced";
    const hasGoal = Object.prototype.hasOwnProperty.call(channel, "goal");
    if (!reduced && hasGoal && goalsEqual(channel.goal, value)) return true;
    const instant = reduced
      || typeof tweenMs !== "number"
      || !Number.isFinite(tweenMs)
      || tweenMs <= 0;
    if (instant) {
      commitEffectiveGoal(channel, value);
      const factor = sampleFactor(member, now());
      member.factor = factor;
      writeMember(member, factor, factor === 1 && !member.trajectory);
      cancelIdleFrame();
      return true;
    }
    const time = now();
    const fromLeaves = sampleEffectiveLeaves(channel, time);
    channel.goal = value;
    channel.effectiveLeaves = fromLeaves;
    channel.effective = emitOpacityMix(fromLeaves);
    channel.effectiveTween = {
      fromLeaves,
      to: value,
      start: time,
      duration: tweenMs,
    };
    ensureFrame();
    return true;
  }

  function beginRequest(fullId) {
    const member = ensureMember(fullId);
    member.failed = false;
    if (member.requestToken == null) member.requestToken = ++serial;
    return member.requestToken;
  }

  function isRequestCurrent(fullId, token) {
    const member = members.get(String(fullId));
    return !!member && !member.invalidated && member.requestToken === token;
  }

  function commitBatch() {
    if (disposed || !pending) return;
    pending.sealed = true;
    tryFinishBatch();
  }

  function discardForRemoval() {
    if (disposed) return;
    for (const member of members.values()) {
      member.invalidated = true;
      member.trajectory = null;
      clearMemberTweens(member);
    }
    dispose();
  }

  function bindMapRemoval() {
    removalDiscards.set(map, discardForRemoval);
    if (typeof map.on !== "function") return;
    const previous = runtimeRemoveHandlers.get(map);
    if (previous && typeof map.off === "function") map.off("remove", previous);
    const onRemove = () => {
      if (runtimeRemoveHandlers.get(map) === onRemove) runtimeRemoveHandlers.delete(map);
      if (typeof map.off === "function") map.off("remove", onRemove);
      discardForRemoval();
    };
    runtimeRemoveHandlers.set(map, onRemove);
    map.on("remove", onRemove);
  }

  function dispose() {
    if (disposed) return;
    settleMountedEffective(true);
    disposed = true;
    if (frameHandle != null) cancelFrame(frameHandle);
    frameHandle = null;
    frameQueued = false;
    clearDeadline();
    for (const member of members.values()) unsubscribe(member);
    members.clear();
    pending = null;
    runtimes.delete(map);
  }

  bindMapRemoval();

  return {
    beginBatch,
    getPendingBatch: () => pending,
    commitBatch,
    setDesiredIds,
    stageMapLayer,
    registerElement,
    markMemberReady,
    markMemberFailed,
    subscribeMemberReady,
    invalidateMember,
    dropChannels,
    readAuthoredOpacity,
    hasPaintChannel,
    updateEffectiveOpacity,
    updateEffectivePaint,
    beginRequest,
    isRequestCurrent,
    getDesiredIds: () => [...desired],
    dispose,
    discard: discardForRemoval,
    isDisposed: () => disposed,
  };
}
