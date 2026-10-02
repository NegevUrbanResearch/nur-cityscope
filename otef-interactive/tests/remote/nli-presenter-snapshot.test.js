import { expect, it } from "vitest";
import { presenterCopyKey } from "../../frontend/src/remote/nli-presenter-content.js";
import { buildPresenterSnapshot, adjacentPresenterKey } from "../../frontend/src/remote/nli-presenter-snapshot.js";
import { idleNliClock, playNliClock, pauseNliClock, endNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import { NLI_NOVA_STORY } from "../../frontend/src/shared/nli-nova-story.js";
import { NLI_PLAYABLE_IDS } from "../../frontend/src/shared/nli-investigation-beats.js";
import { novaVirtualMembership } from "../../frontend/src/shared/nli-nova-virtual-membership.js";
import navigationFixture from "../fixtures/nli-presenter-navigation.json";
import presenterManifest from "../../frontend/src/remote/nli-presenter-content.json";

function makeSnapshotInput({minutes,from=null,to=null,clock=idleNliClock(),nowMs=1000,
  membership=["nli.lines"],narrative={id:null,revision:1},cueMembership=membership,
  locale="he",dataset={generation:1,identity:"fixture-v1",ready:true,error:null},
  connected=true,mutationAllowed=true,playbackFrom=from,playbackTo=to,sceneId="rest-of-day"}={}) {
  const copyMembership=narrative.id==="nova"
    ? novaVirtualMembership(membership,narrative.id,{phase:"paused"}) : membership;
  const records=Object.fromEntries(minutes.map((minute,index)=>{
    const timeLabel=narrative.id==="nova" ? NLI_NOVA_STORY.beats[index]?.eventTime.he
      : `${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;
    const copy={timeLabel,
      title:`Event ${minute}`,summary:null,details:null};
    return [presenterCopyKey(narrative.id,copyMembership,minute),{he:copy,en:copy,sourceRefs:[]}];
  }));
  return {host:{_nliArmPayload:()=>({visibleMembership:membership,beats:minutes,from,to}),
      _playbackWindow:()=>({membership,...(playbackFrom==null?{}:{from:playbackFrom}),...(playbackTo==null?{}:{to:playbackTo})})},
    clock,nowMs,narrative,sceneKey:"rest:1",sceneId,
    cueWindow:{membership:cueMembership,from,to},locale,manifest:{records},
    dataset,connected,mutationAllowed};
}

it("preserves the authored current step id in the presenter snapshot", () => {
  const snapshot = buildPresenterSnapshot(makeSnapshotInput({minutes:[389],sceneId:"opening-minutes"}));
  expect(snapshot.sceneId).toBe("opening-minutes");
});

it("filters the list but preserves the clock's earlier context", () => {
  const snapshot = buildPresenterSnapshot(makeSnapshotInput({
    minutes:[389,400,403,453,454,1197],from:402,to:1197,
    clock:{phase:"playing",beats:[389,400,403,453,454,1197],
      membership:["nli.lines"],positionMs:0,anchorMs:1000,leadInMinutes:402},nowMs:1000
  }));
  expect(snapshot.beats.map(b=>b.minute)).toEqual([403,453,454,1197]);
  expect(snapshot.beats[0].clockIndex).toBe(2);
  expect(snapshot.appliedKey).toBeNull();
  expect(snapshot.previewMinute).toBe(402);
  expect(snapshot.arm).toEqual({ visibleMembership: ["nli.lines"], beats: [389,400,403,453,454,1197], from: 402, to: 1197 });
});

it("keeps canonical indices across the real 7/109 fixture split and event boundaries", () => {
  const all=navigationFixture.minutes;
  expect(all).toHaveLength(116);
  const input=makeSnapshotInput({minutes:all,from:402,to:1197});
  const snap=buildPresenterSnapshot(input);
  expect(snap.beats.map(b=>b.minute)).toEqual(all.slice(7));
  expect(snap.beats).toHaveLength(109);
  expect(snap.beats[0].clockIndex).toBe(7);
  expect(snap.beats.map(b=>b.minute)).toContain(453); // 07:33
  expect(snap.beats.map(b=>b.minute)).toContain(454); // 07:34
  expect(snap.beats.at(-1).minute).toBe(1197); // 19:57 fixture endpoint
});

it("uses actual canonical minute values and stable locale-independent row keys", () => {
  const mins=[453,454,1197];
  const he=buildPresenterSnapshot(makeSnapshotInput({minutes:mins}));
  const en=buildPresenterSnapshot(makeSnapshotInput({minutes:mins,locale:"en"}));
  expect(he.beats.map(b=>b.minute)).toEqual(mins);
  expect(he.beats.map(b=>b.key)).toEqual(en.beats.map(b=>b.key));
});

it("uses Nova representative minutes, virtual membership, and an 08:03 idle preview", () => {
  const membership=[NLI_PLAYABLE_IDS[0]];
  const mins=[...NLI_NOVA_STORY.representativeMinutes];
  const idle=buildPresenterSnapshot(makeSnapshotInput({minutes:mins,membership,
    narrative:{id:"nova",revision:2},cueMembership:membership,from:null,to:null}));
  expect(idle.beats.map(b=>b.minute)).toEqual(mins);
  expect(idle.previewMinute).toBe(483);
  expect(idle.membership).toContain("nli.lines");
  expect(idle.beats.map(b=>b.copy.timeLabel)).toEqual(NLI_NOVA_STORY.beats.map(b=>b.eventTime.he));
  expect(idle.beats[0].copy.timeLabel).toBe("08:12–08:23");
});

it("looks up verified Nova copy while preserving alarm membership in the active clock", () => {
  const membership=["nli.investigation_polygons","nli.lines","nli.alarms"];
  const minutes=[...NLI_NOVA_STORY.representativeMinutes];
  const clock={phase:"playing",beats:minutes,membership,positionMs:4000,anchorMs:0};
  const input=makeSnapshotInput({minutes,membership,narrative:{id:"nova",revision:3},
    cueMembership:membership,clock});
  input.manifest=presenterManifest;
  const snapshot=buildPresenterSnapshot(input);
  expect(snapshot.ready).toBe(true);
  expect(snapshot.canMutate).toBe(true);
  expect(snapshot.beats).toHaveLength(minutes.length);
  expect(snapshot.membership).toEqual([...membership].sort());
  expect(snapshot.arm.visibleMembership).toEqual(membership);
  expect(snapshot.beats.map((beat)=>beat.copyKey)).toEqual(minutes.map((minute)=>
    presenterCopyKey("nova",membership,minute)));
  for (const minute of minutes) {
    const accepted=presenterManifest.records[presenterCopyKey("nova",["nli.investigation_polygons","nli.lines"],minute)];
    const active=presenterManifest.records[presenterCopyKey("nova",membership,minute)];
    expect(active.he).toEqual(accepted.he);
    expect(active.en).toEqual(accepted.en);
    expect(active.sourceRefs).toEqual(accepted.sourceRefs);
  }
});

it("uses a generic last-event hold while playing or paused and bounds adjacent navigation", () => {
  const minutes=[389,400,403];
  for (const phase of ["playing","paused"]) {
    const playing=playNliClock(idleNliClock(),["nli.lines"],minutes,0);
    const clock=phase==="playing" ? playing : pauseNliClock(playing, 11_000);
    const snapshot=buildPresenterSnapshot(makeSnapshotInput({minutes,clock,nowMs:11_000}));
    expect(snapshot.phase).toBe(phase);
    expect(snapshot.beats[snapshot.beats.length-1].key).toBe(snapshot.appliedKey);
    expect(adjacentPresenterKey(snapshot,1)).toBeNull();
    expect(adjacentPresenterKey(snapshot,-1)).toBe(snapshot.beats[1].key);
  }
});

it("holds the final descriptor in explicit ended state", () => {
  const minutes=[389,400,403];
  const clock=endNliClock(playNliClock(idleNliClock(),["nli.lines"],minutes,0));
  const snapshot=buildPresenterSnapshot(makeSnapshotInput({minutes,clock}));
  expect(snapshot.phase).toBe("ended");
  expect(snapshot.appliedKey).toBe(snapshot.beats.at(-1).key);
});

it("keeps complete active route copy after config changes and invalidates combined membership boundaries", () => {
  const minutes=[389,400];
  const routeMembership=["nli.lines"];
  const combinedMembership=["nli.lines","nli.investigation_polygons"];
  const combinedClock={phase:"paused",beats:minutes,membership:combinedMembership,positionMs:4000,anchorMs:0};
  const combinedInput=makeSnapshotInput({minutes,clock:combinedClock,membership:combinedMembership,
    cueMembership:combinedMembership,from:null,to:null});
  combinedInput.manifest.records[presenterCopyKey(null,combinedMembership,400)].he.title="Combined-only facts";
  const before=buildPresenterSnapshot(combinedInput);

  const routeClock={...combinedClock,membership:routeMembership};
  const routeInput=makeSnapshotInput({minutes,clock:routeClock,membership:combinedMembership,
    cueMembership:combinedMembership,from:null,to:null});
  for(const minute of minutes) {
    const copy={timeLabel:`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`,
      title:`Route event ${minute}`,summary:null,details:null};
    routeInput.manifest.records[presenterCopyKey(null,routeMembership,minute)]={he:copy,en:copy};
  }
  const after=buildPresenterSnapshot(routeInput);
  expect(after.ready).toBe(true);
  expect(after.beats).toHaveLength(minutes.length);
  expect(after.appliedKey).toBe(after.beats[1].key);
  expect(after.beats[1].copy.title).toBe("Route event 400");
  expect(after.beats[1].copy.title).not.toBe("Combined-only facts");
  expect(after.beats.map((beat)=>beat.copyKey)).toEqual(minutes.map((minute)=>presenterCopyKey(null,routeMembership,minute)));
  expect(after.sceneBoundaryKey).not.toBe(before.sceneBoundaryKey);
  expect(after.boundaryKey).not.toBe(before.boundaryKey);
});

it("clamps an inherited looping endpoint to the last in-window event", () => {
  const canonical=[389,400,403,453];
  const clock={phase:"paused",beats:canonical,membership:["nli.lines"],loop:true,
    positionMs:13_500,anchorMs:0};
  const snapshot=buildPresenterSnapshot(makeSnapshotInput({minutes:canonical,from:400,to:453,clock}));
  expect(snapshot.beats.map(b=>b.minute)).toEqual([400,403,453]);
  expect(snapshot.appliedKey).toBe(snapshot.beats.at(-1).key);
});

it("retains active route beats when a restrictive polygon cue does not match", () => {
  const minutes=[389,400,403,453];
  const route=["nli.lines"];
  const polygon=["nli.investigation_polygons"];
  const clock={phase:"playing",beats:minutes,membership:route,positionMs:0,anchorMs:1000};
  const snapshot=buildPresenterSnapshot(makeSnapshotInput({minutes,clock,membership:route,
    cueMembership:polygon,from:389,to:400,playbackFrom:null,playbackTo:null}));
  expect(snapshot.beats.map(b=>b.minute)).toEqual(minutes);
  expect(snapshot.beats.at(-1).clockIndex).toBe(3);
});

it("distinguishes scene and dataset generations, and never treats null bounds as zero", () => {
  const base=makeSnapshotInput({minutes:[0,389],from:null,to:null});
  const a=buildPresenterSnapshot(base);
  const b=buildPresenterSnapshot({...base,dataset:{...base.dataset,generation:2}});
  expect(a.beats.map(x=>x.minute)).toEqual([0,389]);
  expect(a.boundaryKey).not.toBe(b.boundaryKey);
});

it("makes empty or unverified copy non-mutable and disconnected snapshots browsable", () => {
  const empty=buildPresenterSnapshot(makeSnapshotInput({minutes:[]}));
  expect(empty.canMutate).toBe(false);
  const disconnected=buildPresenterSnapshot(makeSnapshotInput({minutes:[389],connected:false}));
  expect(disconnected.ready).toBe(true);
  expect(disconnected.canMutate).toBe(false);
  expect(adjacentPresenterKey(disconnected,1)).toBe(disconnected.beats[0].key);
  const missing=buildPresenterSnapshot(makeSnapshotInput({minutes:[389],dataset:{generation:1,identity:"fixture-v1",ready:false,error:"unverified"}}));
  expect(missing.ready).toBe(false);
  expect(missing.canMutate).toBe(false);
});

it("does not expose a row when any requested copy is missing", () => {
  const input=makeSnapshotInput({minutes:[389]});
  input.manifest.records={};
  const snapshot=buildPresenterSnapshot(input);
  expect(snapshot.ready).toBe(false);
  expect(snapshot.beats).toEqual([]);
  expect(snapshot.error).toBeTruthy();
});

it("selects adjacent keys only within the current snapshot", () => {
  const snapshot=buildPresenterSnapshot(makeSnapshotInput({minutes:[389,400,403]}));
  expect(adjacentPresenterKey(snapshot,1)).toBe(snapshot.beats[0].key);
  expect(adjacentPresenterKey(snapshot,-1)).toBeNull();
});
