import { afterEach, expect, test, vi } from 'vitest';
import { createProjectionNamesEntry } from '../../frontend/src/projection/projection-names-entry.js';

const cleanup = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.useRealTimers(); });
function pair() {
  const channels = new Set();
  const createChannel = () => {
    const channel = { onmessage: null, postMessage(data) {
      for (const other of channels) if (other !== channel) queueMicrotask(() => other.onmessage?.({ data }));
    }, close() { channels.delete(channel); } };
    channels.add(channel); return channel;
  };
  const refresh = { left: vi.fn(), right: vi.fn() };
  const make = (output, attempt = 0) => {
    const gate = createProjectionNamesEntry({ output, attempt, instanceId: `${output}-${attempt}`,
      createChannel, onFailure: refresh[output], timeoutMs: 1000, startDelayMs: 100 });
    cleanup.push(() => gate.dispose()); return gate;
  };
  return { left: make('left'), right: make('right'), refresh, make };
}
const wall = { datasetVersion: 'accepted', digest: 'a'.repeat(64), language: 'he' };
const prepared = () => Promise.resolve({ display: { field: wall } });
test('both outputs wait for the slower preparation and agree on a start time', async () => {
  const h = pair(); let release;
  const left = h.left.prepare('cue-1', prepared);
  let entered = false; left.then(() => { entered = true; });
  const right = h.right.prepare('cue-1', () => new Promise(resolve => { release = resolve; }));
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  expect(entered).toBe(false);
  release({ display: { field: wall } });
  const [a, b] = await Promise.all([left, right]);
  expect(a.namesEntry.startAtMs).toBe(b.namesEntry.startAtMs);
  expect(a.namesEntry.startAtMs).toBeGreaterThan(Date.now());
  expect(h.refresh.left).not.toHaveBeenCalled();
});
test('one preparation failure rejects both and requests one coordinated replacement', async () => {
  const h = pair();
  const results = await Promise.allSettled([h.left.prepare('cue-1', prepared),
    h.right.prepare('cue-1', async () => { throw new Error('Canvas unavailable'); })]);
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
  expect(h.refresh.left).toHaveBeenCalledWith('cue-1', expect.stringContaining('Canvas unavailable'), 0);
  expect(h.refresh.right).toHaveBeenCalledTimes(1);
  await expect(h.left.prepare('cue-1', prepared)).rejects.toThrow();
  expect(h.refresh.left).toHaveBeenCalledTimes(1);
});
test('a missing peer times out without switching', async () => {
  vi.useFakeTimers(); const h = pair();
  const result = h.left.prepare('cue-1', prepared).catch(error => error);
  await vi.advanceTimersByTimeAsync(1000);
  expect((await result).message).toContain('right');
  expect(h.refresh.left).toHaveBeenCalledTimes(1);
});
test('different validated wall identities fail the pair rather than enter mismatched layouts', async () => {
  const h = pair();
  const results = await Promise.allSettled([h.left.prepare('cue-1', prepared),
    h.right.prepare('cue-1', async () => ({ display: { field: { ...wall, digest: 'b'.repeat(64) } } }))]);
  expect(results.every(result => result.status === 'rejected')).toBe(true);
});
test('a cancelled cue cannot activate either output or trigger automatic refresh', async () => {
  const h = pair(), abort = new AbortController(); let release;
  const a = h.left.prepare('cue-1', () => new Promise(resolve => { release = resolve; }), { signal: abort.signal }).catch(error => error);
  const b = h.right.prepare('cue-1', prepared).catch(error => error);
  abort.abort(); await Promise.all([a, b]);
  release?.({ display: { field: wall } });
  expect(h.refresh.left).not.toHaveBeenCalled(); expect(h.refresh.right).not.toHaveBeenCalled();
  const next = await Promise.all([h.left.prepare('cue-2', prepared), h.right.prepare('cue-2', prepared)]);
  expect(next[0].namesEntry.startAtMs).toBe(next[1].namesEntry.startAtMs);
});
test('replacement attempts cannot use readiness from the retired renderers', async () => {
  const h = pair(), replacement = h.make('left', 1);
  const old = h.right.prepare('cue-1', prepared).catch(error => error);
  const fresh = replacement.prepare('cue-1', prepared).catch(error => error);
  replacement.dispose(); h.right.dispose();
  expect((await old).name).toBe('AbortError'); expect((await fresh).name).toBe('AbortError');
});
test('a same-cue style return can prepare both outputs again without retired cancellation', async () => {
  const h = pair();
  await Promise.all([h.left.prepare('cue-1', prepared), h.right.prepare('cue-1', prepared)]);
  const left = h.left.prepare('cue-1', prepared);
  await Promise.resolve(); await Promise.resolve();
  const right = h.right.prepare('cue-1', prepared);
  const [a, b] = await Promise.all([left, right]);
  expect(a.namesEntry.startAtMs).toBe(b.namesEntry.startAtMs);
  expect(h.refresh.left).not.toHaveBeenCalled();
});
test('peer failure aborts scene preparation and discards completed and late candidates', async () => {
  const h = pair(); let release, signal;
  const discard = vi.fn();
  const a = h.left.prepare('cue-1', value => { signal = value; return new Promise(resolve => { release = resolve; }); }, { discard }).catch(error => error);
  const b = h.right.prepare('cue-1', async () => { throw new Error('broken renderer'); }).catch(error => error);
  await Promise.all([a, b]); expect(signal.aborted).toBe(true);
  const candidate = { display: { field: wall } }; release(candidate);
  await vi.waitFor(() => expect(discard).toHaveBeenCalledWith(candidate));
});
test('a replacement is promoted only after both final renders succeed', async () => {
  const h = pair(); await Promise.all([h.left.prepare('cue-1', prepared), h.right.prepare('cue-1', prepared)]);
  let shown = false; const a = h.left.displayed('cue-1').then(() => { shown = true; });
  await Promise.resolve(); expect(shown).toBe(false);
  const b = h.right.displayed('cue-1'); await Promise.all([a, b]); expect(shown).toBe(true);
});
test('a late rendering failure prevents promotion on both replacements', async () => {
  const h = pair(), left = h.make('left', 1), right = h.make('right', 1);
  await Promise.all([left.prepare('cue-1', prepared), right.prepare('cue-1', prepared)]);
  const waiting = left.displayed('cue-1').catch(error => error);
  right.fail('cue-1', 'Final Canvas draw failed');
  expect((await waiting).message).toContain('Final Canvas draw failed');
  expect(h.refresh.left).toHaveBeenCalledWith('cue-1', expect.stringContaining('Final Canvas draw failed'), 1);
});
test('a superseding cue cancels the retired final-show delay', async () => {
  vi.useFakeTimers(); const h = pair();
  await Promise.all([h.left.prepare('cue-1', prepared), h.right.prepare('cue-1', prepared)]);
  const oldLeft = h.left.displayed('cue-1').catch(error => error), oldRight = h.right.displayed('cue-1').catch(error => error);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const next = Promise.all([h.left.prepare('cue-2', prepared), h.right.prepare('cue-2', prepared)]);
  await next; await vi.advanceTimersByTimeAsync(100);
  expect((await oldLeft).name).toBe('AbortError'); expect((await oldRight).name).toBe('AbortError');
});
