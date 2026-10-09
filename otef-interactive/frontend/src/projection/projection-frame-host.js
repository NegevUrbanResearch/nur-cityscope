/** Keep fullscreen and the last displayed renderer alive during one Names retry. */
export function mountProjectionFrameHost({ document: doc, window: win, source, rotate = false, title = 'Projection output' } = {}) {
  let active, replacement = null, desiredKey = null, timer = null, disposed = false;
  const attempted = new Set(), childDocuments = new Map();
  const button = doc.createElement('button');
  button.type = 'button'; button.className = 'reversed-output-fullscreen'; button.textContent = 'Fullscreen';
  Object.assign(button.style, { position: 'fixed', top: '12px', left: '12px', zIndex: '10', padding: '12px' });
  const fullscreen = async () => {
    try { await doc.documentElement.requestFullscreen(); }
    catch (error) { button.textContent = `Fullscreen: ${error.message}`; }
  };
  const onFullscreen = () => { button.hidden = Boolean(doc.fullscreenElement); };
  const onKey = event => {
    if (event.key?.toLowerCase() !== 'f' || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (doc.fullscreenElement) void doc.exitFullscreen(); else void fullscreen();
  };
  const onLoad = event => {
    const frame = event.currentTarget;
    childDocuments.get(frame)?.removeEventListener('keydown', onKey, true);
    try { childDocuments.set(frame, frame.contentDocument); frame.contentDocument?.addEventListener('keydown', onKey, true); }
    catch { /* Same-origin renderer policy is checked by message origin too. */ }
  };
  const makeFrame = url => {
    const frame = doc.createElement('iframe');
    frame.title = title; frame.allow = "autoplay; fullscreen 'none'";
    Object.assign(frame.style, { position: 'absolute', inset: '0', display: 'block', width: '100%', height: '100%',
      border: '0', transform: rotate ? 'rotate(180deg)' : 'none', transformOrigin: '50% 50%' });
    frame.addEventListener('load', onLoad);
    url.searchParams.set('projectionHost', '1'); frame.src = url.href;
    return frame;
  };
  const removeFrame = frame => {
    if (!frame) return;
    frame.removeEventListener('load', onLoad);
    childDocuments.get(frame)?.removeEventListener('keydown', onKey, true);
    childDocuments.delete(frame); frame.remove();
  };
  const abandon = () => { win.clearTimeout(timer); timer = null; removeFrame(replacement); replacement = null; };
  const onMessage = event => {
    if (disposed || event.origin !== source.origin || !event.data ||
        ![active.contentWindow, replacement?.contentWindow].includes(event.source)) return;
    const { type, key } = event.data;
    if (key !== null && (typeof key !== 'string' || !key || key.length > 16384)) return;
    if (event.source === active.contentWindow) {
      if (type === 'otef-projection-scene') {
        if (key !== desiredKey) abandon();
        desiredKey = key;
      } else if (type === 'otef-projection-refresh' && key === desiredKey && key && !attempted.has(key)) {
        attempted.add(key);
        while (attempted.size > 20) attempted.delete(attempted.values().next().value);
        abandon();
        const url = new URL(active.src);
        url.searchParams.set('namesEntryRetry', '1'); url.searchParams.set('namesEntryKey', key);
        replacement = makeFrame(url); replacement.style.visibility = 'hidden';
        doc.body.insertBefore(replacement, button);
        timer = win.setTimeout(abandon, 30000);
      }
    } else if (type === 'otef-projection-scene' && key !== desiredKey) {
      abandon();
    } else if (key === desiredKey) {
      if (type === 'otef-projection-entered') {
        win.clearTimeout(timer); timer = null;
        const old = active; active = replacement; replacement = null;
        active.style.visibility = 'visible'; removeFrame(old);
      } else if (type === 'otef-projection-failed') abandon();
    }
  };
  active = makeFrame(new URL(source));
  button.addEventListener('click', fullscreen);
  win.addEventListener('keydown', onKey, true); win.addEventListener('message', onMessage);
  doc.addEventListener('fullscreenchange', onFullscreen);
  doc.body.replaceChildren(active, button); onFullscreen(); doc.title = title;
  return { get iframe() { return active; }, dispose() {
    disposed = true; abandon();
    button.removeEventListener('click', fullscreen);
    win.removeEventListener('keydown', onKey, true); win.removeEventListener('message', onMessage);
    doc.removeEventListener('fullscreenchange', onFullscreen);
    active.removeEventListener('load', onLoad);
    childDocuments.get(active)?.removeEventListener('keydown', onKey, true); childDocuments.clear();
  } };
}
