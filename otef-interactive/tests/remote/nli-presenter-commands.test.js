import { describe, expect, it, vi } from "vitest";
import { createPresenterCommands } from "../../frontend/src/remote/nli-presenter-commands.js";
import { idleNliClock, playNliClock, seekNliClock, pauseNliClock, endNliClock, evaluateClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import { timelineSpanMs } from "../../frontend/src/shared/nli-investigation-beats.js";
import { buildPresenterSnapshot } from "../../frontend/src/remote/nli-presenter-snapshot.js";
import { presenterCopyKey } from "../../frontend/src/remote/nli-presenter-content.js";
import { novaVirtualMembership } from "../../frontend/src/shared/nli-nova-virtual-membership.js";
import { NLI_NOVA_STORY } from "../../frontend/src/shared/nli-nova-story.js";

function makeCommandFixture({minutes=[389,400,403,454],from=402,appliedMinute=403,narrativeId=null,
  phase="playing", connected=true, mutationAllowed=true, cacheReady=true, cachePromise=async()=>true,
  boundaryKey, patch=async next=>({ok:true,clock:next})}={}) {
  const ids=["nli.lines"];
  const copyIds=narrativeId==="nova" ? novaVirtualMembership(ids,narrativeId,{phase:"paused"}) : ids;
  const records=Object.fromEntries(minutes.map((minute,index)=>{
    const copy={timeLabel:`${minute}`,title:`Event ${minute}`,summary:null,details:null};
    return [presenterCopyKey(narrativeId,copyIds,minute),{he:copy,en:copy,sourceRefs:[]}];
  }));
  const arm={visibleMembership:ids,beats:minutes,from,to:null};
  const idle=idleNliClock();
  let clock=idle;
  if (appliedMinute!=null) {
    clock=playNliClock(idle,ids,minutes,1000,{...(from==null?{}:{leadInMinutes:from}),...(narrativeId==="nova"?{narrativeId}: {})});
    if (phase==="paused") clock=pauseNliClock(clock,1000,{...(narrativeId==="nova"?{narrativeId}: {})});
    const index=minutes.indexOf(appliedMinute);
    clock=seekNliClock(clock,index,1000,undefined,narrativeId==="nova"?{narrativeId}:{});
    clock={...clock,phase};
  }
  let cacheReadyState=cacheReady;
  const host={_nliTransportEpoch:0,_manualMutationsOpen:()=>true,_nliCacheReady:()=>cacheReadyState,
    _ensureNliFeatureCache:vi.fn(cachePromise),_patchNliClock:vi.fn(patch),
    _nliArmPayload:()=>arm,_playbackWindow:()=>({from,to:null})};
  let currentSnapshot;
  const rebuild=()=> {
    const raw=buildPresenterSnapshot({host,clock,nowMs:1000,narrative:{id:narrativeId,revision:1},sceneKey:"fixture",
      cueWindow:{membership:ids,from,to:null},manifest:{records},dataset:{identity:"fixture",generation:1,ready:true},connected,mutationAllowed});
    currentSnapshot={...raw,from,canMutate:raw.canMutate && mutationAllowed,...(boundaryKey?{boundaryKey}: {})};
    return currentSnapshot;
  };
  rebuild();
  const context={getInvestigationClock:()=>clock,correctedNow:()=>1000};
  const onPending=vi.fn(),onError=vi.fn();
  return {host,context,onPending,onError,get snapshot(){return currentSnapshot;},get clock(){return clock;},setSnapshot(next){currentSnapshot=next;},
    setClock(next){clock=next;rebuild();},setCacheReady(value){cacheReadyState=value;},commands:createPresenterCommands({host,context,getSnapshot:()=>currentSnapshot,onPending,onError})};
}

describe("guarded presenter commands",()=>{
  it("seeks a visible beat using its original clock index and pauses",async()=>{
    const f=makeCommandFixture();
    await f.commands.select(f.snapshot.beats.at(-1).key);
    expect(f.host._patchNliClock).toHaveBeenCalledTimes(1);
    const payload=f.host._patchNliClock.mock.calls[0][0];
    expect(payload.phase).toBe("paused");
    expect(payload.seekKind).toBe("jump");
    expect(payload.beats).toEqual([389,400,403,454]);
    expect(payload.positionMs).toBeGreaterThan(0);
  });
  it("last-event Next never wraps even when the armed clock loops",async()=>{
    const f=makeCommandFixture({minutes:[403,454],from:402,appliedMinute:454});
    f.setClock({...f.clock,loop:true});
    await f.commands.step(1);
    expect(f.host._patchNliClock).not.toHaveBeenCalled();
  });
  it("Previous from a final hold selects the penultimate beat and pauses",async()=>{
    const f=makeCommandFixture({minutes:[403,454],appliedMinute:454,phase:"paused"});
    await f.commands.step(-1);
    expect(f.host._patchNliClock.mock.calls[0][0]).toMatchObject({phase:"paused",seekKind:"jump",beats:[403,454]});
    expect(f.host._patchNliClock.mock.calls[0][0].positionMs).toBe(0);
  });
  it("Previous works from the playing final hold and Next does not wrap",async()=>{
    for (const phase of ["playing","paused"]) {
      const f=makeCommandFixture({minutes:[403,454],appliedMinute:454,phase});
      let clock=playNliClock(idleNliClock(),["nli.lines"],[403,454],1000);
      clock={...clock,positionMs:timelineSpanMs([403,454])+1};
      if (phase==="paused") clock=pauseNliClock(clock,1000);
      f.setClock(clock);
      expect(evaluateClock(f.clock,1000).mode).toBe("hold");
      expect(f.snapshot.phase).toBe(phase);
      await f.commands.step(1);
      expect(f.host._patchNliClock).not.toHaveBeenCalled();
      await f.commands.step(-1);
      expect(f.host._patchNliClock).toHaveBeenCalledTimes(1);
      expect(f.host._patchNliClock.mock.calls[0][0]).toMatchObject({phase:"paused",seekKind:"jump",beats:[403,454],positionMs:0});
    }
  });
  it("Next from the 06:42 lead-in selects the first 06:43 event",async()=>{
    const f=makeCommandFixture({from:402,appliedMinute:389,phase:"playing"});
    f.setClock(playNliClock(idleNliClock(),["nli.lines"],[389,400,403,454],1000,{leadInMinutes:402}));
    await f.commands.step(1);
    expect(f.host._patchNliClock.mock.calls[0][0]).toMatchObject({phase:"paused",seekKind:"jump",beats:[389,400,403,454]});
    expect(f.host._patchNliClock.mock.calls[0][0].positionMs).toBe(seekNliClock(f.clock,2,1000,f.snapshot.arm).positionMs);
  });
  it("explicitly arms only the visible membership from idle",async()=>{
    const f=makeCommandFixture({appliedMinute:null});
    await f.commands.select(f.snapshot.beats[1].key);
    expect(f.host._patchNliClock.mock.calls[0][0]).toMatchObject({phase:"paused",membership:["nli.lines"],beats:[389,400,403,454]});
  });
  it("plays the armed scene window from idle",async()=>{
    const f=makeCommandFixture({appliedMinute:null});
    await f.commands.toggle();
    expect(f.host._patchNliClock.mock.calls[0][0]).toMatchObject({phase:"playing",membership:["nli.lines"],beats:[389,400,403,454]});
  });
  it("pauses a playing clock and resumes a paused clock",async()=>{
    const playing=makeCommandFixture({appliedMinute:403,phase:"playing"});
    await playing.commands.toggle();
    expect(playing.host._patchNliClock.mock.calls[0][0].phase).toBe("paused");
    const paused=makeCommandFixture({appliedMinute:403,phase:"paused"});
    await paused.commands.toggle();
    expect(paused.host._patchNliClock.mock.calls[0][0].phase).toBe("playing");
  });
  it("rejects disconnected or presentation-locked commands",async()=>{
    for (const f of [makeCommandFixture({connected:false}),makeCommandFixture()]) {
      if (f.snapshot.canMutate) f.host._manualMutationsOpen=()=>false;
      const result=await f.commands.toggle();
      expect(result).toMatchObject({ok:false,stale:true});
      expect(f.host._patchNliClock).not.toHaveBeenCalled();
    }
  });
  it("rejects a scene boundary change during cache readiness",async()=>{
    let resolveCache;
    const f=makeCommandFixture({cacheReady:false,cachePromise:()=>new Promise(resolve=>{resolveCache=resolve;})});
    const pending=f.commands.select(f.snapshot.beats[0].key);
    f.setSnapshot({...f.snapshot,boundaryKey:"replacement"});
    f.setCacheReady(true);
    resolveCache(true);
    expect(await pending).toMatchObject({ok:false,stale:true});
    expect(f.host._patchNliClock).not.toHaveBeenCalled();
  });
  it("drops cache work when the dataset is replaced",async()=>{
    let resolveCache;
    const f=makeCommandFixture({cacheReady:false,cachePromise:()=>new Promise(resolve=>{resolveCache=resolve;})});
    const pending=f.commands.select(f.snapshot.beats[0].key);
    f.setSnapshot({...f.snapshot,datasetIdentity:"new-dataset",datasetGeneration:2,boundaryKey:"new-dataset-boundary"});
    f.setCacheReady(true);
    resolveCache(true);
    expect(await pending).toMatchObject({ok:false,stale:true});
    expect(f.host._patchNliClock).not.toHaveBeenCalled();
  });
  it("drops cache work when the transport epoch changes",async()=>{
    let resolveCache;
    const f=makeCommandFixture({cacheReady:false,cachePromise:()=>new Promise(resolve=>{resolveCache=resolve;})});
    const pending=f.commands.select(f.snapshot.beats[0].key);
    f.host._nliTransportEpoch+=1;
    f.setCacheReady(true);
    resolveCache(true);
    expect(await pending).toMatchObject({ok:false,stale:true});
    expect(f.host._patchNliClock).not.toHaveBeenCalled();
  });
  it("treats cache timeout as stale without sending a clock patch",async()=>{
    const f=makeCommandFixture({cacheReady:false,cachePromise:async()=>false});
    const result=await f.commands.select(f.snapshot.beats[0].key);
    expect(result).toMatchObject({ok:false,stale:true});
    expect(f.host._patchNliClock).not.toHaveBeenCalled();
  });
  it("does not overlap activations while cache readiness is pending",async()=>{
    let resolveCache;
    const f=makeCommandFixture({cacheReady:false,cachePromise:()=>new Promise(resolve=>{resolveCache=resolve;})});
    const first=f.commands.select(f.snapshot.beats[0].key);
    const second=await f.commands.toggle();
    expect(second).toMatchObject({ok:false,stale:true});
    expect(f.host._patchNliClock).not.toHaveBeenCalled();
    f.setCacheReady(true);
    resolveCache(true);
    await first;
    expect(f.host._patchNliClock).toHaveBeenCalledTimes(1);
  });
  it("ignores a cache completion after invalidation",async()=>{
    let resolveCache;
    const f=makeCommandFixture({cacheReady:false,cachePromise:()=>new Promise(resolve=>{resolveCache=resolve;})});
    const pending=f.commands.select(f.snapshot.beats[0].key);
    f.commands.invalidate();
    f.setCacheReady(true);
    resolveCache(true);
    expect(await pending).toMatchObject({ok:false,stale:true});
    expect(f.host._patchNliClock).not.toHaveBeenCalled();
  });
  it("reports a non-stale rejected acknowledgement",async()=>{
    const f=makeCommandFixture({patch:async()=>({ok:false,error:"rejected"})});
    const result=await f.commands.select(f.snapshot.beats[0].key);
    expect(result).toMatchObject({ok:false,error:"rejected"});
    expect(f.onError).toHaveBeenCalledTimes(1);
  });
  it("keeps stale acknowledgements quiet",async()=>{
    const f=makeCommandFixture({patch:async()=>({ok:false,stale:true})});
    const result=await f.commands.select(f.snapshot.beats[0].key);
    expect(result).toMatchObject({ok:false,stale:true});
    expect(f.onError).not.toHaveBeenCalled();
  });
  it("does not return a successful acknowledgement after the snapshot changes in flight",async()=>{
    let resolvePatch;
    const f=makeCommandFixture({patch:()=>new Promise(resolve=>{resolvePatch=resolve;})});
    const pending=f.commands.select(f.snapshot.beats[0].key);
    f.setSnapshot({...f.snapshot,boundaryKey:"replacement"});
    resolvePatch({ok:true,clock:f.clock});
    expect(await pending).toMatchObject({ok:false,stale:true});
    expect(f.onError).not.toHaveBeenCalled();
  });
  it("exposes a presenter command only while its request is unsettled",async()=>{
    let resolvePatch;
    const f=makeCommandFixture({patch:()=>new Promise(resolve=>{resolvePatch=resolve;})});
    const pending=f.commands.select(f.snapshot.beats[0].key);
    expect(f.commands.isPending()).toBe(true);
    resolvePatch({ok:true,clock:f.clock});
    await pending;
    expect(f.commands.isPending()).toBe(false);
  });
  it("replays from the scene lead-in after a mid-scene selection removed it",async()=>{
    const f=makeCommandFixture({from:402,appliedMinute:403,phase:"paused"});
    await f.commands.select(f.snapshot.beats[1].key);
    f.setClock(f.host._patchNliClock.mock.calls[0][0]);
    f.host._patchNliClock.mockClear();
    f.setClock(endNliClock(f.clock));
    await f.commands.toggle();
    const replay=f.host._patchNliClock.mock.calls[0][0];
    expect(replay.phase).toBe("playing");
    expect(replay.leadInMinutes).toBe(402);
    expect(evaluateClock(replay,1000,{leadInMinutes:402}).leadIn).toBe(true);
  });
  it("uses Nova narrative options when seeking its representative beats",async()=>{
    const minutes=[...NLI_NOVA_STORY.representativeMinutes];
    const f=makeCommandFixture({minutes,from:null,appliedMinute:minutes[0],narrativeId:"nova"});
    await f.commands.select(f.snapshot.beats[2].key);
    expect(f.host._patchNliClock.mock.calls[0][0]).toMatchObject({phase:"paused",beats:minutes});
    expect(f.host._patchNliClock.mock.calls[0][0].positionMs).toBeGreaterThan(0);
  });
});
