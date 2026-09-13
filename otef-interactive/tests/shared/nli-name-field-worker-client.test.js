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
