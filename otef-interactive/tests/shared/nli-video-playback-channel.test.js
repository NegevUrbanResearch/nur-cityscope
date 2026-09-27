import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createNliVideoPlaybackPublisher,
  subscribeNliVideoPlayback,
} from "../../frontend/src/shared/nli-video-playback-channel.js";

let channels;
class FakeBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    this.listeners = new Set();
    this.postCount = 0;
    channels.push(this);
  }
  postMessage(data) {
    if (this.closed) return;
    this.postCount += 1;
    for (const channel of channels) {
      if (channel !== this && !channel.closed && channel.name === this.name) {
        const event = { data: structuredClone(data) };
        channel.onmessage?.(event);
        for (const listener of channel.listeners) listener(event);
      }
    }
  }
  addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === "message") this.listeners.delete(listener); }
  close() { this.closed = true; }
}

beforeEach(() => { channels = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("late subscribers query current active state and heartbeat refreshes the local lease", () => {
  const source = createNliVideoPlaybackPublisher({
    table: "otef", BroadcastChannelImpl: FakeBroadcastChannel,
  });
  source.setActive(true);
  let active = false;
  const unsubscribe = subscribeNliVideoPlayback({
    table: "otef", BroadcastChannelImpl: FakeBroadcastChannel, onChange: (value) => { active = value; },
  });
  expect(active).toBe(true);
  vi.advanceTimersByTime(5000);
  expect(active).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(active).toBe(true);
  source.dispose();
  expect(active).toBe(false);
  unsubscribe();
});

test("active sources are combined and only their own newer inactive state releases them", () => {
  const first = createNliVideoPlaybackPublisher({ table: "otef", BroadcastChannelImpl: FakeBroadcastChannel });
  const second = createNliVideoPlaybackPublisher({ table: "otef", BroadcastChannelImpl: FakeBroadcastChannel });
  let active = false;
  const unsubscribe = subscribeNliVideoPlayback({
    table: "otef", BroadcastChannelImpl: FakeBroadcastChannel, onChange: (value) => { active = value; },
  });
  first.setActive(true);
  second.setActive(true);
  first.setActive(false);
  expect(active).toBe(true);
  second.setActive(false);
  expect(active).toBe(false);
  first.dispose(); second.dispose(); unsubscribe();
});

test("messages for another table and stale sequence numbers are ignored", () => {
  let active = false;
  const unsubscribe = subscribeNliVideoPlayback({
    table: "otef", BroadcastChannelImpl: FakeBroadcastChannel, onChange: (value) => { active = value; },
  });
  const source = new FakeBroadcastChannel("otef-nli-video-playback-v1");
  source.postMessage({ type: "state", table: "other", sourceId: "source", sequence: 3, active: true });
  expect(active).toBe(false);
  source.postMessage({ type: "state", table: "otef", sourceId: "source", sequence: 2, active: true });
  source.postMessage({ type: "state", table: "otef", sourceId: "source", sequence: 1, active: false });
  expect(active).toBe(true);
  source.postMessage({ type: "state", table: "otef", sourceId: "source", sequence: 3, active: false });
  expect(active).toBe(false);
  unsubscribe();
});

test("two receivers answer no queries and do not create a message loop", () => {
  const seen = [];
  const stopA = subscribeNliVideoPlayback({
    table: "otef", BroadcastChannelImpl: FakeBroadcastChannel, onChange: (value) => seen.push(["a", value]),
  });
  const stopB = subscribeNliVideoPlayback({
    table: "otef", BroadcastChannelImpl: FakeBroadcastChannel, onChange: (value) => seen.push(["b", value]),
  });
  const sent = channels.reduce((total, channel) => total + channel.postCount, 0);
  expect(sent).toBe(2);
  expect(seen).toEqual([]);
  stopA(); stopB();
});

test("a crashed active publisher expires once without a zero-delay timer loop", () => {
  let active = false;
  const unsubscribe = subscribeNliVideoPlayback({
    table: "otef", BroadcastChannelImpl: FakeBroadcastChannel, onChange: (value) => { active = value; },
  });
  const crashedSource = new FakeBroadcastChannel("otef-nli-video-playback-v1");
  crashedSource.postMessage({ type: "state", table: "otef", sourceId: "crashed-source", sequence: 1, active: true });
  expect(active).toBe(true);
  crashedSource.close();
  vi.advanceTimersByTime(6000);
  expect(active).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  unsubscribe();
});

test("pagehide releases the source and suspends heartbeats until pageshow", () => {
  const windowRef = new EventTarget();
  const source = createNliVideoPlaybackPublisher({
    table: "otef", BroadcastChannelImpl: FakeBroadcastChannel, windowRef,
  });
  let active = false;
  const unsubscribe = subscribeNliVideoPlayback({
    table: "otef", BroadcastChannelImpl: FakeBroadcastChannel, onChange: (value) => { active = value; },
  });
  source.setActive(true);
  expect(active).toBe(true);
  windowRef.dispatchEvent(new Event("pagehide"));
  expect(active).toBe(false);
  const countAfterHide = channels[0].postCount;
  vi.advanceTimersByTime(3000);
  expect(channels[0].postCount).toBe(countAfterHide);
  windowRef.dispatchEvent(new Event("pageshow"));
  expect(active).toBe(true);
  source.dispose(); unsubscribe();
});

test("an unsupported BroadcastChannel leaves the receiver inactive and warns once", () => {
  const warn = vi.fn();
  const unsubscribe = subscribeNliVideoPlayback({ table: "otef", BroadcastChannelImpl: null, onChange: vi.fn(), warn });
  expect(warn).toHaveBeenCalledOnce();
  unsubscribe();
});
