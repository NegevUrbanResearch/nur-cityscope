/** Keep packing work off the GIS/projector render thread. */
export function runNameFieldWorker(payload, WorkerConstructor) {
  return new Promise((resolve, reject) => {
    const worker = WorkerConstructor
      ? new WorkerConstructor(new URL('./nli-name-field-worker.js', import.meta.url), {type:'module'})
      : new Worker(new URL('./nli-name-field-worker.js', import.meta.url), {type:'module'});
    const finish = (error, field) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error); else resolve(field);
    };
    const timer = setTimeout(() => finish(new Error('Name field calculation timed out')), 60000);
    worker.onmessage = ({data}) => finish(data?.error ? new Error(data.error) : null, data?.field);
    worker.onerror = (event) => finish(new Error(event.message || 'Name field worker failed'));
    try { worker.postMessage(payload); } catch(error) { finish(error); }
  });
}
