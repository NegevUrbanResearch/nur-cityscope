const tools = [
  ['pre', 'Shared transform', 'Scale, rotation and source position', '◇'],
  ...['left', 'right'].flatMap(side => [
    [`${side}-crop`, 'Crop', 'Source bounds', '⌗'],
    [`${side}-fit`, 'Position & scale', 'Scale and position', '↔'],
    [`${side}-keystone`, 'Keystone', 'Four corner corrections', '⏢'],
    [`${side}-grid`, 'Grid warp', 'Correction points and grid layout', '▦'],
  ]),
  ['content', 'Content', 'Border visibility and display fonts', '☷'],
  ['names-wall', 'Names wall', 'Wall and model placement profiles', 'Aa'],
  ['settlement-names', 'Settlement names', 'Labels, outlines and leader lines', '⌁'],
  ['clock-gis', 'GIS clock', 'Clock layout for each scene', '◷'],
  ['clock-projection', 'Projection clock & legend', 'Shared left projection overlays', '▤'],
  ['road-signs', 'Road 232 signs', 'Place signs on GIS and projectors', '⬡'],
  ['nova-explainers', 'Nova explainers', 'Story cards on the GIS map', '▱'],
];
const calibration = id => id === 'pre' || /^(left|right)-/.test(id);

export function createConfigNavigation({ document: doc, onSelect = () => {}, onBack = () => true } = {}) {
  const make = (tag, className, text = '') => {
    const el = doc.createElement(tag); el.className = className; el.textContent = text; return el;
  };
  const element = make('section', 'config-navigation');
  element.dataset.view = 'diagram';
  const tabs = make('nav', 'config-diagram-tabs'); tabs.setAttribute('aria-label', 'Configuration');
  tabs.append(make('span', 'config-brand', 'OTEF · Projection'));
  let category = 'calibration', selected = 'pre';
  const panels = {}, tabButtons = [];
  const diagram = make('div', 'config-diagram');
  for (const [id, label] of [['calibration', 'Image calibration'], ['content', 'Content, names & overlays']]) {
    const tab = make('button', 'config-diagram-tab', label); tab.type = 'button'; tab.dataset.configTab = id;
    tab.onclick = () => { category = id; render(); }; tabs.append(tab); tabButtons.push(tab);
    const panel = panels[id] = make('section', `config-diagram-panel config-diagram-${id}`);
    panel.append(make('h1', 'config-diagram-title', label)); diagram.append(panel);
  }
  const cards = new Map();
  const card = id => {
    const [, title, detail, icon] = tools.find(t => t[0] === id);
    const button = make('button', 'config-diagram-card'); button.type = 'button'; button.dataset.configNode = id;
    button.append(make('span', 'config-diagram-icon', icon));
    const label = make('span', 'config-diagram-label'); label.append(make('strong', '', title), make('small', '', detail));
    button.append(label, make('span', 'config-diagram-chevron', '›')); button.onclick = () => onSelect(id);
    cards.set(id, button); return button;
  };
  const shared = make('div', 'config-shared-stage'); shared.append(card('pre')); panels.calibration.append(shared, make('div', 'config-diagram-split'));
  const branches = make('div', 'config-diagram-branches');
  for (const side of ['left', 'right']) {
    const branch = make('section', 'config-diagram-branch'); branch.append(make('h2', '', `${side === 'left' ? 'Left' : 'Right'} projector`));
    for (const type of ['crop', 'fit', 'keystone', 'grid']) branch.append(card(`${side}-${type}`)); branches.append(branch);
  }
  panels.calibration.append(branches);
  const contentShared = make('div', 'config-shared-stage'); contentShared.append(card('content')); panels.content.append(contentShared);
  const library = make('div', 'config-content-cards');
  for (const [id] of tools.filter(t => !calibration(t[0]) && t[0] !== 'content')) library.append(card(id)); panels.content.append(library);
  const editorBar = make('nav', 'config-editor-navigation'); editorBar.setAttribute('aria-label', 'Current editor');
  const back = make('button', 'config-diagram-back', '‹ Diagram'); back.type = 'button'; back.dataset.configBack = '';
  back.onclick = () => { if (onBack() !== false) showDiagram(); };
  const title = make('h1', 'config-editor-title');
  const scope = make('div', 'config-projector-switch'); scope.setAttribute('role', 'group'); scope.setAttribute('aria-label', 'Projector');
  for (const side of ['left', 'right']) {
    const button = make('button', '', side === 'left' ? 'Left' : 'Right'); button.type = 'button'; button.dataset.projector = side;
    button.onclick = () => { if (!selected.startsWith(side)) onSelect(selected.replace(/^(left|right)/, side)); }; scope.append(button);
  }
  const both = make('span', 'config-both-projectors', 'Both projectors'); editorBar.append(back, title, scope, both);
  element.append(tabs, diagram, editorBar);
  function render() {
    const editing = element.dataset.view === 'editor';
    tabs.hidden = editing; diagram.hidden = editing; editorBar.hidden = !editing;
    for (const [id, panel] of Object.entries(panels)) panel.hidden = category !== id;
    for (const tab of tabButtons) tab.setAttribute('aria-pressed', String(category === tab.dataset.configTab));
    title.textContent = tools.find(t => t[0] === selected)?.[1] || 'Projection settings';
    scope.hidden = !/^(left|right)-/.test(selected); both.hidden = selected !== 'pre';
    for (const button of scope.children) button.setAttribute('aria-pressed', String(selected.startsWith(button.dataset.projector)));
  }
  function showDiagram() { element.dataset.view = 'diagram'; render(); }
  render();
  return {
    element, editorBar, cards, showDiagram,
    select(id) { selected = id; category = calibration(id) ? 'calibration' : 'content'; element.dataset.view = 'editor'; render(); },
    update(id) { selected = id; render(); },
    dispose() { element.remove(); },
  };
}
