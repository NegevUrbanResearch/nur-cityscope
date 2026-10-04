export function withRequestDeadline(operation, {
  timeoutMs = 15000,
  signal,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  if (typeof operation !== 'function') return Promise.reject(new TypeError('operation must be a function'));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return Promise.reject(new RangeError('timeoutMs must be a non-negative finite number'));
  if (signal?.aborted) return Promise.reject(abortError(signal.reason));

  const controller = new AbortController();
  let timer = null;
  let settled = false;
  let rejectInterruption;
  const interruption = new Promise((_, reject) => { rejectInterruption = reject; });
  const cleanup = () => {
    if (timer !== null) clearTimer(timer);
    signal?.removeEventListener?.('abort', onParentAbort);
  };
  const interrupt = (error) => {
    if (settled) return;
    controller.abort(error);
    rejectInterruption(error);
  };
  const onParentAbort = () => interrupt(abortError(signal.reason));
  signal?.addEventListener?.('abort', onParentAbort, { once: true });
  timer = setTimer(() => {
    const error = new Error(`request timed out after ${timeoutMs}ms`);
    error.code = 'request_timeout';
    interrupt(error);
  }, timeoutMs);

  let work;
  try { work = Promise.resolve(operation(controller.signal)); }
  catch (error) { work = Promise.reject(error); }

  return Promise.race([work, interruption]).finally(() => {
    settled = true;
    cleanup();
  });
}

function abortError(reason) {
  const error = new Error(typeof reason === 'string' ? reason : 'request aborted');
  error.name = 'AbortError';
  error.code = 'request_aborted';
  return error;
}
