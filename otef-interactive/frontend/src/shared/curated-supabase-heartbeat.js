/**
 * Periodic pull: Django re-reads Supabase geo_features into published curated GISLayers.
 * Replaces the unused Colab → sync-submission POST (problematic behind Docker).
 */

const DEFAULT_INTERVAL_MS = 20000;

/**
 * @param {object} [options]
 * @param {string} [options.table="otef"] OTEF table name
 * @param {number} [options.intervalMs=20000] poll interval
 * @param {(detail: object) => void | Promise<void>} [options.onUpdated] called when `updated > 0`
 * @returns {() => void} stop function
 */
export function startCuratedSupabaseHeartbeat(options = {}) {
  const table = options.table || "otef";
  const intervalMs =
    typeof options.intervalMs === "number" && options.intervalMs >= 5000
      ? options.intervalMs
      : DEFAULT_INTERVAL_MS;
  const onUpdated =
    typeof options.onUpdated === "function" ? options.onUpdated : null;

  let timer = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const url = `/api/supabase/curated/pull-from-supabase/?table=${encodeURIComponent(table)}`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      const n = Number(data.updated) || 0;
      if (n > 0 && onUpdated) {
        await onUpdated(data);
      }
    } catch (_) {
      /* non-fatal: network / 502 while Supabase restarts */
    }
  };

  void tick();
  timer = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
}
