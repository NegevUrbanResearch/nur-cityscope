/**
 * Whether a curated Supabase pull response should trigger GIS / projection reloads.
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
export function shouldTriggerCuratedReload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const u = Number(payload.updated);
  const a = Number(payload.autopublished);
  const updated = Number.isFinite(u) ? u : 0;
  const autopublished = Number.isFinite(a) ? a : 0;
  return updated + autopublished > 0;
}
