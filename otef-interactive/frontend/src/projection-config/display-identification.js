export const IDENTIFICATION_DURATION_MS = 5000;

export function numberDisplays(screens) {
  const ordered = [...screens].sort((a, b) => a.left - b.left || a.top - b.top || a.key.localeCompare(b.key));
  return screens.map((screen) => ({ ...screen, displayNumber: ordered.indexOf(screen) + 1 }));
}

export function createDisplayIdentifier({ open, location, sessionId }) {
  const windows = new Set();
  let timeout = null;
  let generation = 0;

  function close() {
    clearTimeout(timeout);
    timeout = null;
    for (const win of windows) {
      try { if (!win.closed) win.close(); windows.delete(win); }
      catch { /* Retain the handle so a later cleanup can retry. */ }
    }
    return windows.size === 0;
  }

  function show(screens) {
    if (!close()) throw new Error("Close the previous display-number windows before identifying again.");
    generation += 1;
    try {
      for (const screen of screens) {
        const url = new URL("./display-identify.html", new URL(location, globalThis.location?.href || "http://localhost/"));
        url.searchParams.set("display", String(screen.displayNumber));
        const width = Math.min(360, screen.availWidth);
        const height = Math.min(320, screen.availHeight);
        const left = Math.round(screen.availLeft + (screen.availWidth - width) / 2);
        const top = Math.round(screen.availTop + (screen.availHeight - height) / 2);
        const win = open(url.href, `otef-display-identify-${sessionId}-${generation}-${screen.displayNumber}`, `popup,width=${width},height=${height},left=${left},top=${top}`);
        if (!win) throw new Error("Display-number popup blocked. Allow popups for this site, then press Identify displays again.");
        windows.add(win);
        win.focus?.();
      }
      timeout = setTimeout(close, IDENTIFICATION_DURATION_MS);
    } catch (error) {
      const cleaned = close();
      if (!cleaned) throw new Error(`${error.message} Close any remaining display-number windows manually.`);
      throw error;
    }
  }

  return { show, close };
}
