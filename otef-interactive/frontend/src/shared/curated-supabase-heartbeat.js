/**
 * Manual Supabase → Django sync for published curated GISLayers (geo_features).
 * Workshop **refresh** triggers `pullCuratedFromSupabaseOnce`; there is no polling timer.
 *
 * After a successful pull, Django broadcasts `otef_layers_changed` so GIS / projection /
 * remote refresh layer state via OTEFDataContext (no duplicate pull per surface).
 */

/**
 * @param {object} [options]
 * @param {string} [options.table="otef"] OTEF table name
 * @returns {Promise<{ ok: boolean, status: number, data: object | null }>}
 */
export async function pullCuratedFromSupabaseOnce(options = {}) {
  const table = options.table || "otef";
  try {
    const url = `/api/supabase/curated/pull-from-supabase/?table=${encodeURIComponent(table)}`;
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
