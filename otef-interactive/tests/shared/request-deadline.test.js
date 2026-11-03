import { afterEach, expect, test, vi } from 'vitest';
import { withRequestDeadline } from '../../frontend/src/shared/request-deadline.js';

afterEach(() => vi.useRealTimers());

test('retires a request that ignores abort at the deadline', async () => {
  vi.useFakeTimers();
  const operation = vi.fn(() => new Promise(() => {}));
  const pending = withRequestDeadline(operation, { timeoutMs: 15000 });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'request_timeout' });
  await vi.advanceTimersByTimeAsync(15000);
  await rejected;
  expect(operation.mock.calls[0][0].aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('parent abort retires an operation that ignores its signal and clears its timer', async () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  const operation = vi.fn(() => new Promise(() => {}));
  const pending = withRequestDeadline(operation, { signal: parent.signal });
  parent.abort();
  await expect(pending).rejects.toMatchObject({ code: 'request_aborted', name: 'AbortError' });
  expect(operation.mock.calls[0][0].aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('clears deadline resources when the operation completes', async () => {
  vi.useFakeTimers();
  await expect(withRequestDeadline(async () => 'accepted')).resolves.toBe('accepted');
  expect(vi.getTimerCount()).toBe(0);
});
