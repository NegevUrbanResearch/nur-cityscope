/** Keep packing work off the GIS/projector render thread. */
export function runNameFieldWorker(payload, WorkerConstructor, signal) {
  const aborted = () => Object.assign(new Error('Name field calculation cancelled'), { name: 'AbortError' });
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const worker = WorkerConstructor
      ? new WorkerConstructor(new URL('./nli-name-field-worker.js', import.meta.url), {type:'module'})
      : new Worker(new URL('./nli-name-field-worker.js', import.meta.url), {type:'module'});
    let settled = false;
    let timer = null;
    const finish = (error, field) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      if (error) reject(error); else resolve(field);
    };
    const onAbort = () => finish(aborted());
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    timer = setTimeout(() => finish(new Error('Name field calculation timed out')), 60000);
    worker.onmessage = ({data}) => finish(data?.error ? new Error(data.error) : null, data?.field);
    worker.onerror = (event) => finish(new Error(event.message || 'Name field worker failed'));
    try { worker.postMessage(payload); } catch(error) { finish(error); }
  });
}
