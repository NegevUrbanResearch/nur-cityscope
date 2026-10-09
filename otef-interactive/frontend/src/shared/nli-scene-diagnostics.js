/** Keep failures across page refreshes; never let diagnostic storage affect recovery. */
export function reportNliSceneFailure(diagnostic) {
  const record = { ...diagnostic, timestamp: new Date().toISOString() };
  console.warn("[nli-scene] transition or restoration failed; retaining committed scene", record);
  const key = `otef.nli.sceneFailures.${record.displayProfile || "display"}.${record.output || "full"}`;
  try {
    if (typeof window === "undefined") return;
    const storage = window.localStorage;
    if (!storage) return;
    let history;
    try { history = JSON.parse(storage.getItem(key) || "[]"); } catch { history = []; }
    if (!Array.isArray(history)) history = [];
    storage.setItem(key, JSON.stringify([...history.slice(-19), record]));
  } catch { /* Quota limits or blocked storage cannot interfere with the scene. */ }
}
