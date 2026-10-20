export function bindTabletManagementVisibility(element, win) {
  const navigator = win?.navigator;
  const queries = ['(pointer: coarse)', '(hover: none)', '(any-pointer: fine)'].map(query => win?.matchMedia?.(query));
  const tabletPlatform = /Android|iPad/i.test(`${navigator?.userAgentData?.platform || ''} ${navigator?.userAgent || ''}`) ||
    navigator?.platform === 'MacIntel' && navigator?.maxTouchPoints > 1;
  const update = () => {
    element.hidden = tabletPlatform || Boolean(navigator?.maxTouchPoints > 0 && queries[0]?.matches && queries[1]?.matches && !queries[2]?.matches);
    if (element.hidden) element.open = false;
  };
  for (const query of queries) query?.addEventListener?.('change', update);
  update();
  return () => { for (const query of queries) query?.removeEventListener?.('change', update); };
}
