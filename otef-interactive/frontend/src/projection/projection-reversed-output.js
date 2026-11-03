import { mountProjectionFrameHost } from './projection-frame-host.js';

/** Rotate the finished output, including warp and overlays, on the opposite display. */
export function mountReversedProjection({ document: doc, window: win, location } = {}) {
  const url = new URL(location.href);
  const side = url.searchParams.get('span');
  if (!['left', 'right'].includes(side) || ['preview', 'clockPreview', 'settlementPreview'].some(key => url.searchParams.get(key) === '1')) return null;
  const source = new URL('projection.html', url);
  source.search = url.search;
  source.searchParams.set('span', side === 'left' ? 'right' : 'left');
  source.searchParams.set('outputMode', 'browser');
  source.searchParams.set('matchDisplaySide', side);
  source.searchParams.set('matchReversed', '1');
  return mountProjectionFrameHost({ document: doc, window: win, source, rotate: true,
    title: `OTEF Reversed Projection | ${side} display` });
}
