export function waitForProjectionConfigStartup(client, { signal } = {}) {
  if (!client || typeof client.start !== "function" || typeof client.subscribe !== "function") {
    return Promise.reject(new TypeError("projection config startup requires a client"));
  }
  return new Promise((resolve, reject) => {
    let unsubscribe = null;
    let settled = false;
    const cleanup = () => {
      unsubscribe?.();
      signal?.removeEventListener?.("abort", onAbort);
    };
    const finish = (error, state) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve(state);
    };
    const onAbort = () => finish(Object.assign(new Error("Projection config startup cancelled"), { name: "AbortError" }));
    const check = (state) => {
      if (state?.snapshot?.config || state?.hydrationError) finish(null, state);
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    let starting;
    try { starting = client.start(); }
    catch (error) { finish(error); return; }
    Promise.resolve(starting).then((state) => {
      if (settled) return;
      const current = state || client.getState?.();
      check(current);
      if (settled) return;
      unsubscribe = client.subscribe(check);
      if (settled) unsubscribe?.();
    }, (error) => finish(error));
  });
}
