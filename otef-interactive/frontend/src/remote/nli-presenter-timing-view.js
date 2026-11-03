const formatDuration = (ms, roundUp = false) => {
  const seconds = (roundUp ? Math.ceil : Math.floor)(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Refresh only playback progress; leave event browsing and card scroll untouched. */
export function createPresenterTimingView({ root, getSnapshot }) {
  const row = document.createElement("div");
  row.className = "nli-presenter-timing";
  row.dataset.presenterTiming = "";
  row.dir = "ltr";
  const labels = document.createElement("div");
  labels.className = "nli-presenter-timing-labels";
  const elapsedLabel = document.createElement("span");
  const totalLabel = document.createElement("span");
  labels.append(elapsedLabel, totalLabel);
  const readout = document.createElement("div");
  readout.className = "nli-presenter-timing-readout";
  const elapsed = document.createElement("bdi");
  const total = document.createElement("bdi");
  elapsed.dir = total.dir = "ltr";
  total.className = "nli-presenter-timing-total";
  const track = document.createElement("div");
  track.className = "nli-presenter-timing-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  const fill = document.createElement("div");
  fill.className = "nli-presenter-timing-fill";
  track.append(fill);
  readout.append(elapsed, track, total);
  row.append(labels, readout);
  root.append(row);
  let timer = null, visible = true, disposed = false;
  const stop = () => { clearTimeout(timer); timer = null; };

  function update(snapshot) {
    stop();
    if (disposed) return;
    const timing = snapshot?.timing;
    row.hidden = !snapshot?.ready || !timing || timing.durationMs <= 0;
    if (row.hidden) return;
    const locale = snapshot.locale || document.documentElement.lang;
    const isEnglish = locale === "en";
    elapsedLabel.dir = totalLabel.dir = isEnglish ? "ltr" : "rtl";
    elapsedLabel.textContent = isEnglish ? "Elapsed time" : "זמן שעבר";
    totalLabel.textContent = isEnglish ? "Total time" : "זמן כולל";
    const elapsedMs = Math.max(0, Math.min(timing.durationMs, timing.durationMs - timing.remainingMs));
    elapsed.textContent = formatDuration(elapsedMs, elapsedMs === timing.durationMs);
    total.textContent = formatDuration(timing.durationMs, true);
    fill.style.width = `${elapsedMs / timing.durationMs * 100}%`;
    track.setAttribute("aria-label", isEnglish ? "Scene playback progress" : "התקדמות הסצנה");
    track.setAttribute("aria-valuemax", String(timing.durationMs / 1000));
    track.setAttribute("aria-valuenow", String(elapsedMs / 1000));
    track.setAttribute("aria-valuetext", `${elapsedLabel.textContent}: ${elapsed.textContent}, ${totalLabel.textContent}: ${total.textContent}`);
    if (visible && snapshot.phase === "playing" && typeof getSnapshot === "function") {
      timer = setTimeout(() => update(getSnapshot()), 1000);
    }
  }

  function setVisible(next) { visible = Boolean(next); if (!visible) stop(); }
  function dispose() { disposed = true; stop(); }
  return { update, setVisible, dispose };
}
