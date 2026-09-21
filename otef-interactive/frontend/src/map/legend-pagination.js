/** Stack already-measured full-width legend blocks into ordered pages. */
export function packLegendPages(blocks, availableHeight) {
  const pages = [];
  const oversizedBlockIds = [];
  const height = Number(availableHeight);
  let page = [];
  let used = 0;
  let pageGroups = new Set();
  const flush = () => {
    if (page.length > 0) pages.push(page);
    page = [];
    used = 0;
    pageGroups = new Set();
  };
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const blockHeight = Math.max(0, Number(block?.height) || 0);
    const groupId = block?.groupId;
    if (blockHeight > height) {
      oversizedBlockIds.push(block.id);
      flush();
      pages.push([block.id]);
      continue;
    }
    if (page.length > 0 && (used + blockHeight > height || (groupId && pageGroups.has(groupId)))) {
      flush();
    }
    page.push(block.id);
    used += blockHeight;
    if (groupId) pageGroups.add(groupId);
  }
  flush();
  return { pages, oversizedBlockIds };
}
