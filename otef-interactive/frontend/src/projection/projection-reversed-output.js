/** Rotate the finished output, including warp and overlays, on the opposite display. */
export function mountReversedProjection({ document: doc, window: win, location } = {}) {
  const url = new URL(location.href);
  const side = url.searchParams.get('span');
  if (!['left', 'right'].includes(side) || ['preview', 'clockPreview', 'settlementPreview'].some(key => url.searchParams.get(key) === '1')) return null;
  const source = new URL('projection.html', url);
  source.searchParams.set('span', side === 'left' ? 'right' : 'left');
  source.searchParams.set('outputMode', 'browser');
  const iframe = doc.createElement('iframe');
  iframe.title = `${side} display: reversed ${side === 'left' ? 'right' : 'left'} output`;
  iframe.allow = "autoplay; fullscreen 'none'";
  Object.assign(iframe.style, { display: 'block', width: '100%', height: '100%', border: '0', transform: 'rotate(180deg)', transformOrigin: '50% 50%' });
  const button = doc.createElement('button');
  button.type = 'button'; button.className = 'reversed-output-fullscreen'; button.textContent = 'Fullscreen';
  const fullscreen = async () => {
    try { await doc.documentElement.requestFullscreen(); }
    catch (error) { button.textContent = `Fullscreen: ${error.message}`; }
  };
  const onKey = event => {
    if (event.key?.toLowerCase() !== 'f' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (doc.fullscreenElement) void doc.exitFullscreen();
    else void fullscreen();
  };
  let childDocument = null;
  const onLoad = () => {
    childDocument?.removeEventListener('keydown', onKey, true);
    childDocument = iframe.contentDocument;
    childDocument?.addEventListener('keydown', onKey, true);
  };
  button.addEventListener('click', fullscreen);
  win.addEventListener('keydown', onKey, true);
  iframe.addEventListener('load', onLoad);
  doc.body.replaceChildren(iframe, button);
  iframe.src = source.href;
  doc.title = `OTEF Reversed Projection | ${side} display`;
  return { iframe, dispose() {
    button.removeEventListener('click', fullscreen);
    win.removeEventListener('keydown', onKey, true);
    iframe.removeEventListener('load', onLoad);
    childDocument?.removeEventListener('keydown', onKey, true);
  } };
}
