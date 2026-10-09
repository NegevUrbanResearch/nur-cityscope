import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { filterGazaBorderVisibility } from "../../frontend/src/shared/gaza-border-style.js";

describe("projection Nova marker filter wiring", () => {
  test("filters people synchronously immediately after projection layer sync", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    const start=source.indexOf('function syncProjectionLayersWithNarrative('),end=source.indexOf('const syncProjectionLayersAndRaiseHighlight',start);
    for (const active of [false,true]) {
      const events=[],normal=[{id:'normal'}],landmarks=[{id:'landmarks'}],map={};
      const syncLayers=vi.fn((...args)=>events.push(['layers',...args]));
      const people=vi.fn((...args)=>events.push(['people',...args])),houses=vi.fn((...args)=>events.push(['houses',...args]));
      const dim=vi.fn(),clear=vi.fn();
      const sync=new Function('calibrationActive','calibrationGroups','syncProjectionLayers','browserSurface','applyNarrativePeopleFilter','OTEFDataContext','applyPeopleFocusDim','clearPeopleFocusDim','applyNarrativeHouseOutlineFilter',`${source.slice(start,end)};return syncProjectionLayersWithNarrative;`)(()=>active,landmarks,syncLayers,null,people,{getNarrativeState:()=>({id:'nova'}),getPersonSelection:()=>({personId:'person'})},dim,clear,houses);
      sync(map,normal,{});expect(events.map(event=>event[0])).toEqual(['layers','people','houses']);
      expect(syncLayers.mock.calls[0][1]).toBe(active?landmarks:normal);expect(people).toHaveBeenCalledWith(map,active?null:'nova');expect(houses).toHaveBeenCalledWith(map,active?null:'nova');
      if(active)expect(clear).toHaveBeenCalledWith(map);else expect(dim).toHaveBeenCalledWith(map,'person');
    }
  });

  test("calibration suppresses selected-person focus and release restores the latest narrative and selection", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../../frontend/src/entries/projection-main.js"), "utf8");
    const start = source.indexOf("function syncProjectionLayersWithNarrative(");
    const end = source.indexOf("const syncProjectionLayersAndRaiseHighlight", start);
    let active = true, narrativeId = "nova", personId = "first";
    const people = vi.fn(), houses = vi.fn(), dim = vi.fn(), clear = vi.fn();
    const sync = new Function("calibrationActive", "calibrationGroups", "syncProjectionLayers", "browserSurface", "applyNarrativePeopleFilter", "OTEFDataContext", "applyPeopleFocusDim", "clearPeopleFocusDim", "applyNarrativeHouseOutlineFilter", `${source.slice(start, end)};return syncProjectionLayersWithNarrative;`)(
      () => active, [], () => {}, null, people,
      { getNarrativeState: () => ({ id: narrativeId }), getPersonSelection: () => ({ personId }) }, dim, clear, houses,
    );
    const map = {};
    sync(map, [], {});
    narrativeId = "segev";
    personId = "latest";
    sync(map, [], {});
    expect(people).toHaveBeenLastCalledWith(map, null);
    expect(houses).toHaveBeenLastCalledWith(map, null);
    expect(clear).toHaveBeenCalledTimes(2);
    expect(dim).not.toHaveBeenCalled();
    active = false;
    sync(map, [], {});
    expect(people).toHaveBeenLastCalledWith(map, "segev");
    expect(houses).toHaveBeenLastCalledWith(map, "segev");
    expect(dim).toHaveBeenLastCalledWith(map, "latest");
  });
});
