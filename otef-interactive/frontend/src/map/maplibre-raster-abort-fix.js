/**
 * MapLibre 5.24.0 RasterTileSource.loadTile awaits transformRequest, then rereads
 * tile.abortController. abortTile deletes that property during the await, so
 * ImageRequest.getImage is queued with undefined and crashes on `.signal`
 * (fixed upstream by #8004 in 6.1.0, with transform cancellation in #8071
 * in 6.4.0). Give each raster load its own view of the controller property so
 * overlapping loads of the same Tile cannot delete each other's controller.
 * A superseded load is cancelled and cannot overwrite the newest tile state.
 * Leave the native image fetch and GPU upload intact. Raster-DEM has a separate
 * load implementation and additional awaits; this fix does not cover it.
 */

const INSTALLED = "_otefRasterAbortFix";
const loads = new WeakMap();

function abortError() {
  const error = new Error("AbortError");
  error.name = "AbortError";
  return error;
}

function tileForLoad(tile, load) {
  return new Proxy(tile, {
    get(target, key, receiver) {
      if (key === "abortController") {
        // Check immediately before native getImage: its queue does not settle
        // requests that were already aborted when inserted.
        if (load.controller.signal.aborted) throw abortError();
        return load.controller;
      }
      if (key === "aborted") {
        return load.controller.signal.aborted || loads.get(tile) !== load || target.aborted;
      }
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value) {
      if (key === "abortController") return true;
      if (key === "state" && loads.get(tile) !== load) return true;
      return Reflect.set(target, key, value, target);
    },
    deleteProperty(target, key) {
      if (key === "abortController") return true;
      return Reflect.deleteProperty(target, key);
    },
  });
}

function wrapAbortTile(originalAbortTile) {
  return async function abortTile(tile) {
    const load = this.type === "raster" && loads.get(tile);
    if (load) {
      load.controller.abort();
      return;
    }
    return originalAbortTile.call(this, tile);
  };
}

function wrapLoadTile(originalLoadTile) {
  return async function loadTile(tile) {
    if (this.type !== "raster") return originalLoadTile.call(this, tile);
    loads.get(tile)?.controller.abort();
    const load = { controller: new AbortController() };
    loads.set(tile, load);
    try {
      return await originalLoadTile.call(this, tileForLoad(tile, load));
    } catch (error) {
      if (load.controller.signal.aborted || tile.aborted || error?.name === "AbortError") {
        if (loads.get(tile) === load) tile.state = "unloaded";
        return;
      }
      throw error;
    } finally {
      if (loads.get(tile) === load) loads.delete(tile);
    }
  };
}

export function installMapLibreRasterAbortFix(maplibregl) {
  if (!maplibregl) return null;
  if (maplibregl.getVersion?.() !== "5.24.0") return maplibregl;
  const proto = maplibregl.RasterTileSource?.prototype;
  if (!proto || typeof proto.loadTile !== "function" || Object.hasOwn(proto, INSTALLED)) return maplibregl;
  proto.loadTile = wrapLoadTile(proto.loadTile);
  if (typeof proto.abortTile === "function") {
    proto.abortTile = wrapAbortTile(proto.abortTile);
  }
  proto[INSTALLED] = true;
  return maplibregl;
}
