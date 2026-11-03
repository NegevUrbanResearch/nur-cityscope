export function bindLayerScrollCue(root) {
  const port = root?.querySelector?.(".group-layers");
  const more = root?.querySelector?.("button[data-layers-more]");
  if (!port || !more) return () => {};

  const document = port.ownerDocument;
  const window = document.defaultView;
  let stopped = false;
  let frame = null;

  const update = () => {
    if (stopped || port.closest("[hidden]") || port.clientHeight <= 0) return;
    const stripHeight = more.hidden ? 0 : more.getBoundingClientRect().height
      + (Number.parseFloat(window.getComputedStyle(more).marginBlockStart) || 0);
    const overflow = port.scrollHeight > port.clientHeight + stripHeight + 2;
    const atEnd = overflow && port.scrollHeight - port.clientHeight - port.scrollTop <= 2;
    const focused = document.activeElement === more;
    more.hidden = !overflow;
    more.classList.toggle("is-at-end", atEnd);
    port.classList.toggle("is-scrolled", port.scrollTop > 2);
    if (focused && (!overflow || atEnd)) port.focus({ preventScroll: true });
  };

  const schedule = () => {
    if (stopped || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      update();
    });
  };
  const scroll = () => {
    port.scrollBy({
      top: Math.max(104, port.clientHeight * .7),
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant" : "smooth",
    });
  };

  more.addEventListener("click", scroll);
  port.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  const observer = typeof window.ResizeObserver === "function"
    ? new window.ResizeObserver(schedule) : null;
  observer?.observe(port);
  const grid = port.querySelector(".layer-tile-grid");
  if (grid) observer?.observe(grid);
  document.fonts?.ready.then(schedule);
  schedule();

  return () => {
    if (stopped) return;
    stopped = true;
    more.removeEventListener("click", scroll);
    port.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    observer?.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
  };
}
