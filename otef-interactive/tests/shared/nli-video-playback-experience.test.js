import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createNliVideoPlaybackPublisher, subscribeNliVideoPlayback } from "../../frontend/src/shared/nli-video-playback-channel.js";

let channels;
class Channel {
  constructor() { this.listeners = new Set(); this.messages = []; channels.push(this); }
  addEventListener(_type, fn) { this.listeners.add(fn); }
  removeEventListener(_type, fn) { this.listeners.delete(fn); }
  postMessage(message) { this.messages.push(structuredClone(message)); for (const channel of channels) if (channel !== this) for (const listener of channel.listeners) listener({ data: message }); }
  close() { this.listeners.clear(); }
}
beforeEach(() => { channels = []; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
const options = () => ({ table: "otef", BroadcastChannelImpl: Channel, websocketClientFactory: null, warn: vi.fn() });

test("a playback lifetime and its cleanup never inherit a later activation", () => {
  let scope = { experience: "nli", experience_revision: 4 };
  const publisher = createNliVideoPlaybackPublisher({ ...options(), captureExperienceScope: () => scope, isExperienceScopeCurrent: captured => captured.experience_revision === scope.experience_revision });
  publisher.setActive(true);
  scope = { experience: "regular", experience_revision: 5 };
  vi.advanceTimersByTime(1000);
  publisher.setActive(false);
  publisher.dispose();
  expect(channels[0].messages.every(message => message.experience === "nli" && message.experience_revision === 4)).toBe(true);
  expect(channels[0].messages.at(-1).active).toBe(false);
});

test("inactive NLI output cannot publish a new active lifetime as regular", () => {
  const publisher = createNliVideoPlaybackPublisher({ ...options(), captureExperienceScope: () => ({ experience: "regular", experience_revision: 5 }) });
  publisher.setActive(true);
  expect(channels[0].messages.some(message => message.active === true)).toBe(false);
  publisher.dispose();
});

test("BroadcastChannel stale or unversioned state cannot suppress the current projection", () => {
  const changes = [];
  const stop = subscribeNliVideoPlayback({ ...options(), captureExperienceScope: () => ({ experience: "nli", experience_revision: 5 }), isExperienceScopeCurrent: scope => scope.experience === "nli" && scope.experience_revision === 5, onChange: value => changes.push(value) });
  const source = new Channel();
  const message = { type: "state", table: "otef", sourceId: "gis", sequence: 1, active: true };
  source.postMessage(message);
  source.postMessage({ ...message, experience: "nli", experience_revision: 4 });
  expect(changes).toEqual([]);
  source.postMessage({ ...message, experience: "nli", experience_revision: 5 });
  expect(changes).toEqual([true]);
  stop();
});

test("experience transitions immediately release stale suppression without waiting for lease expiry", () => {
  let scope = { experience: "nli", experience_revision: 4 }, notify;
  const changes = [];
  const stop = subscribeNliVideoPlayback({ ...options(), captureExperienceScope: () => scope, isExperienceScopeCurrent: captured => captured.experience === scope.experience && captured.experience_revision === scope.experience_revision, subscribeExperience: fn => { notify = fn; return () => {}; }, onChange: value => changes.push(value) });
  const source = new Channel();
  source.postMessage({ type: "state", table: "otef", sourceId: "gis", sequence: 1, active: true, ...scope });
  expect(changes).toEqual([true]);
  scope = { experience: "regular", experience_revision: 5 };
  notify({ active_experience: "regular", revision: 5 });
  expect(changes).toEqual([true, false]);
  stop();
});
