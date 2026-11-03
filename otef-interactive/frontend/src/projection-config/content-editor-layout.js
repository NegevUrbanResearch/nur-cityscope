let nextPageGroup = 0;

export function mountContentEditor({ dialog, header, panel, status, host, presentation, document }) {
  const embedded = presentation === 'panel' && Boolean(host?.appendChild);
  if (embedded) {
    dialog.className += ' config-content-editor';
    dialog.setAttribute('role', 'region');
    dialog.removeAttribute?.('aria-modal');
    header.hidden = true;
    if (status) panel.appendChild(status);
  }
  (embedded ? host : document.body)?.appendChild(dialog);
  if (embedded) { dialog.tabIndex = -1; dialog.focus?.({ preventScroll: true }); }
  return embedded;
}

export function createContentEditorPages(doc, pages, { beforeChange = () => true, onSelect = () => {} } = {}) {
  const group = `content-pages-${++nextPageGroup}`;
  const element = doc.createElement('div'); element.className = 'content-editor-pages';
  const tabs = doc.createElement('div'); tabs.className = 'content-editor-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Settings');
  const items = pages.map(({ id, label, nodes }) => {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
    button.dataset.editorPage = id; button.id = `${group}-${id}-tab`; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `${group}-${id}`);
    const panel = doc.createElement('section'); panel.className = 'content-editor-page'; panel.dataset.editorPagePanel = id; panel.id = `${group}-${id}`;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id); panel.append(...nodes);
    tabs.appendChild(button);
    return { id, button, panel };
  });
  let selected = items[0]?.id;
  function render() {
    for (const item of items) {
      const active = item.id === selected;
      item.panel.hidden = !active; item.button.setAttribute('aria-selected', String(active)); item.button.tabIndex = active ? 0 : -1;
    }
  }
  function select(id, focus = false) {
    if (id !== selected && !beforeChange()) return false;
    selected = id; render();
    onSelect(id);
    if (focus) items.find(item => item.id === id)?.button.focus?.();
    return true;
  }
  for (const [index, item] of items.entries()) {
    item.button.addEventListener('click', () => select(item.id));
    item.button.addEventListener('keydown', event => {
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!direction && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault?.();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + direction + items.length) % items.length;
      select(items[next].id, true);
    });
  }
  element.append(tabs, ...items.map(item => item.panel)); render();
  return { element, select };
}
