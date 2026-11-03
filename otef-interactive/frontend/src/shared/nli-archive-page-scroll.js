export function pageAmount(innerHeight, direction) {
  const amount = Math.round(innerHeight * 0.9);
  return direction === "down" ? amount : -amount;
}

export function chooseScrollTarget(doc, innerHeight) {
  function overflows(element) {
    return element.scrollHeight > element.clientHeight + 8;
  }

  const root = doc.scrollingElement || doc.documentElement;
  if (root && overflows(root)) return root;

  const view = doc.defaultView;
  if (!view) return null;

  const minHeight = innerHeight * 0.35;
  let best = null;
  for (const element of doc.querySelectorAll("*")) {
    const overflowY = view.getComputedStyle(element).overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    if (!overflows(element) || element.clientHeight < minHeight) continue;
    if (!best || element.clientHeight > best.clientHeight) best = element;
  }
  return best;
}

export function runArchivePageScroll(win, direction) {
  if (win.location.protocol !== "https:" || win.location.hostname !== "www.nli.org.il") {
    return { scrolled: false };
  }
  const target = chooseScrollTarget(win.document, win.innerHeight);
  if (!target) return { scrolled: false };
  target.scrollBy({ top: pageAmount(win.innerHeight, direction), behavior: "auto" });
  return { scrolled: true };
}

export const ARCHIVE_PAGE_SCROLL_EVAL = `(() => {
  const pageAmount = ${pageAmount.toString()};
  const chooseScrollTarget = ${chooseScrollTarget.toString()};
  const run = ${runArchivePageScroll.toString()};
  return run(window, direction);
})()`;
