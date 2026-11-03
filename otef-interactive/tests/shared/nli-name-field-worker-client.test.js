import { expect,it,vi } from 'vitest';
import { runNameFieldWorker } from '../../frontend/src/shared/nli-name-field-worker-client.js';
it('returns a complete field and terminates the worker',async()=>{
  let worker;
  class FakeWorker { constructor(){worker=this;this.terminate=vi.fn();} postMessage(payload){this.payload=payload;} }
  const promise=runNameFieldWorker({names:3},FakeWorker);
  expect(worker.payload).toEqual({names:3});
  worker.onmessage({data:{field:{total:3}}});
  await expect(promise).resolves.toEqual({total:3});
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('rejects capacity failure and cleans up',async()=>{
  let worker;
  class FakeWorker { constructor(){worker=this;this.terminate=vi.fn();} postMessage(){} }
  const promise=runNameFieldWorker({},FakeWorker);
  worker.onmessage({data:{error:'Name field capacity'}});
  await expect(promise).rejects.toThrow('capacity');
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('terminates an in-flight layout worker when its calibration is superseded', async () => {
  let worker;
  class FakeWorker { constructor() { worker = this; this.terminate = vi.fn(); } postMessage() {} }
  const controller = new AbortController();
  const outcome = runNameFieldWorker({}, FakeWorker, controller.signal).then(() => 'resolved', (error) => error);
  controller.abort();
  const terminatedAtAbort = worker.terminate.mock.calls.length;
  if (!terminatedAtAbort) worker.onmessage({ data: { field: {} } });
  expect(terminatedAtAbort).toBe(1);
  expect(await outcome).toMatchObject({ name: 'AbortError' });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
