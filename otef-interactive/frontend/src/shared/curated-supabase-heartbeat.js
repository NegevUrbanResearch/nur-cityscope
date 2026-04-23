/**
 * Periodic pull: Django re-reads Supabase geo_features into published curated GISLayers.
 * Replaces the unused Colab → sync-submission POST (problematic behind Docker).
 *
 * Multiple callers (GIS map, projection wall) may register `onUpdated` handlers; they share
 * one interval + fetch per table so both surfaces refresh after a pull.
 */

import { isOtefCurationEmbedded } from "../curation/curation-embed.js";
import { shouldTriggerCuratedReload } from "./curated-supabase-reload-trigger.js";

const DEFAULT_INTERVAL_MS = 20000;

/** @type {{ table: string, intervalMs: number, timer: ReturnType<typeof setInterval> | null, listeners: Set<(detail: object) => void | Promise<void>>, stopped: boolean } | null} */
let sharedHb = null;

/**
 * @param {object} [options]
 * @param {string} [options.table="otef"] OTEF table name
 * @param {number} [options.intervalMs=20000] poll interval
 * @param {(detail: object) => void | Promise<void>} [options.onUpdated] called when pull reports updates or autopublishes
 * @returns {() => void} stop function
 */
export function startCuratedSupabaseHeartbeat(options = {}) {
  if (typeof window !== "undefined" && isOtefCurationEmbedded()) {
    return () => {};
  }

  const table = options.table || "otef";
  const intervalMs =
    typeof options.intervalMs === "number" && options.intervalMs >= 5000
      ? options.intervalMs
      : DEFAULT_INTERVAL_MS;
  const onUpdated =
    typeof options.onUpdated === "function" ? options.onUpdated : null;

  if (!onUpdated) {
    return () => {};
  }

  const tick = async () => {
    if (!sharedHb || sharedHb.stopped) return;
    try {
      const url = `/api/supabase/curated/pull-from-supabase/?table=${encodeURIComponent(sharedHb.table)}`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      if (!shouldTriggerCuratedReload(data)) return;
      const fns = [...sharedHb.listeners];
      for (const fn of fns) {
        try {
          await fn(data);
        } catch (_) {
          /* non-fatal: one consumer failing should not break others */
        }
      }
    } catch (_) {
      /* non-fatal: network / 502 while Supabase restarts */
    }
  };

  if (!sharedHb) {
    sharedHb = {
      table,
      intervalMs,
      timer: null,
      listeners: new Set(),
      stopped: false,
    };
    void tick();
    sharedHb.timer = setInterval(() => void tick(), intervalMs);
  } else if (sharedHb.table !== table) {
    console.warn(
      `[CuratedHeartbeat] ignoring start for table "${table}"; already polling "${sharedHb.table}"`,
    );
    return () => {};
  }

  sharedHb.listeners.add(onUpdated);

  return () => {
    if (!sharedHb) return;
    sharedHb.listeners.delete(onUpdated);
    if (sharedHb.listeners.size === 0) {
      sharedHb.stopped = true;
      if (sharedHb.timer) clearInterval(sharedHb.timer);
      sharedHb.timer = null;
      sharedHb = null;
    }
  };
}
