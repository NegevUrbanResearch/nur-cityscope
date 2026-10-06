const keyFor = row => `${row.output}/${row.instanceId}`;
const clone = value => JSON.parse(JSON.stringify(value));
const isResponder = row => row?.type === 'otef_projection_applied' && row.table === 'otef' &&
  ['left', 'right'].includes(row.output) && typeof row.instanceId === 'string' &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.instanceId) &&
  Number.isSafeInteger(row.revision) && row.revision >= 0 && typeof row.success === 'boolean';

/** Raw responders remain separate by logical output AND live instance. Keep this monitor for late-output invalidation. */
export function monitorProjectionOutputs({ socket, onResponder = () => {} } = {}) {
  const responders = new Map();
  const receive = row => {
    if (!isResponder(row)) return;
    const fresh = clone(row); responders.set(keyFor(fresh), fresh); onResponder(clone(fresh));
  };
  socket.on('otef_projection_applied', receive);
  return { getResponders: () => new Map([...responders].map(([key, row]) => [key, clone(row)])),
    dispose: () => socket.off('otef_projection_applied', receive) };
}

/** Fresh response window; no statusRows cache. Retain a separate monitor for the enclosing editor session. */
export function discoverOutputs({ socket, sourceId, timeoutMs = 1000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const abortError = () => Object.assign(new Error('Output discovery cancelled'), { name: 'AbortError' });
    if (signal?.aborted) { reject(abortError()); return; }
    const monitor = monitorProjectionOutputs({ socket });
    let timer;
    const cleanup = () => { clearTimeout(timer); monitor.dispose(); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { const rows = monitor.getResponders(); cleanup(); resolve(rows); }, timeoutMs);
    try { socket.send({ type: 'otef_projection_status_request', table: 'otef', sourceId }); }
    catch (error) { cleanup(); reject(error); }
  });
}
