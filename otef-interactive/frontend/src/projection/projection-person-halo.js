import {
  clearPersonHalo,
  loadPeopleRuntime as defaultLoadPeopleRuntime,
  mountPersonHalo,
} from "../map/maplibre-person-selection.js";

function selectionPid(selection) {
  const raw = selection?.personId ?? selection?.pid;
  return raw == null || String(raw).trim() === "" ? "" : String(raw).trim();
}

function personFromRuntime(runtime, pid, datasetVersion) {
  if (!runtime || typeof runtime.resolve !== "function" || !pid) return null;
  const resolved = runtime.resolve(pid, datasetVersion);
  const coordinates = resolved?.coordinates || resolved?.geometry?.coordinates;
  if (!resolved || !Array.isArray(coordinates) || coordinates.length < 2) return null;
  return { ...resolved, pid: resolved.pid || pid, coordinates };
}

/** Projection person halo only: no flyTo, Popup, or GIS controller. */
export function bindProjectionPersonHalo({
  map,
  subscribe,
  loadPeopleRuntime = defaultLoadPeopleRuntime,
  motionMode = "full",
} = {}) {
  let disposed = false;
  let current = null;
  let generation = 0;
  const runtimePromise = Promise.resolve(
    typeof loadPeopleRuntime === "function" ? loadPeopleRuntime() : null,
  );

  const remountCurrent = () => {
    if (disposed || !current) return;
    clearPersonHalo(map);
    mountPersonHalo(map, current, { motionMode, displayProfile: "projection" });
  };

  const apply = (selection) => {
    const token = ++generation;
    const pid = selectionPid(selection);
    if (!pid) {
      current = null;
      clearPersonHalo(map);
      return;
    }
    const datasetVersion = selection?.datasetVersion;
    void runtimePromise.then((runtime) => {
      if (disposed || token !== generation) return;
      const person = personFromRuntime(runtime, pid, datasetVersion);
      if (!person) {
        current = null;
        clearPersonHalo(map);
        return;
      }
      current = person;
      mountPersonHalo(map, person, { motionMode, displayProfile: "projection" });
    });
  };

  map?.on?.("style.load", remountCurrent);
  const unsubscribe = typeof subscribe === "function"
    ? subscribe("personSelection", (value) => { if (!disposed) apply(value); })
    : null;

  return () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    current = null;
    map?.off?.("style.load", remountCurrent);
    if (typeof unsubscribe === "function") unsubscribe();
    clearPersonHalo(map);
  };
}
