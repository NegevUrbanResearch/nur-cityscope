/** Match controls use pointer events for touch, pen and mouse; timers never survive selection or mode changes. */
export function createPointMatchControls({ document: doc, onAction = () => {} }) {
  const element = doc.createElement('section'); element.className = 'point-match-controls'; element.hidden = true;
  element.setAttribute('aria-label', 'Match points');
  const heading = doc.createElement('h3'); heading.textContent = 'Match points';
  const note = doc.createElement('p'); note.textContent = 'Match points uses a local draft; Apply publishes the fit. Select a slot and click an image feature. Move its yellow target onto the physical counterpart, then Record target. Repeat for four well-spaced points.';
  const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const slots = doc.createElement('div'); slots.className = 'point-match-slots';
  const buttons = new Map();
  function button(label, action, value) {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label; node.dataset.matchAction = action;
    node.addEventListener('click', () => { cancelMotion(); onAction(action, value); }); buttons.set(action, node); return node;
  }
  for (let id = 1; id <= 6; id++) {
    const row = doc.createElement('div'); row.dataset.matchSlot = String(id);
    const select = button(String(id), 'select', id); select.setAttribute('aria-label', `Select ${id > 4 ? 'checkpoint' : 'fit point'} ${id}`);
    const detail = doc.createElement('span'); detail.className = 'point-match-slot-status';
    const replace = button('Replace', 'replace', id), remove = button('Delete', 'remove', id);
    row.append(select, detail, replace, remove); slots.append(row);
  }
  const step = doc.createElement('select'); step.setAttribute('aria-label', 'Target movement speed');
  for (const [value, label] of [['fast', 'Fast · 10 px'], ['normal', 'Normal · 1 px'], ['fine', 'Fine · 0.25 px']]) {
    const option = doc.createElement('option'); option.value = value; option.textContent = label; step.append(option);
  }
  step.value = 'normal'; step.addEventListener('change', () => onAction('step', step.value));
  const sizes = doc.createElement('div'); sizes.className = 'point-match-sizes';
  const sizeSelects = new Map();
  for (const [kind, title] of [['preview', 'Preview marker size'], ['projected', 'Projected marker size']]) {
    const label = doc.createElement('label'); label.textContent = title;
    const select = doc.createElement('select'); select.setAttribute('aria-label', title);
    for (const [value, text] of [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]) {
      const option = doc.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    select.value = 'medium';
    select.addEventListener('change', () => { cancelMotion(); onAction(`${kind}-marker-size`, select.value); });
    label.append(select); sizes.append(label); sizeSelects.set(kind, select);
  }
  const arrows = doc.createElement('div'); arrows.className = 'point-match-arrows';
  let held = null, repeat = null, state = null, padPointer = null; const touches = new Set();
  const win = doc.defaultView;
  function cancelMotion() { if (repeat !== null) win.clearInterval(repeat); repeat = null; held = null; padPointer = null; onAction('cancel-motion'); }
  for (const [direction, label] of [['up','↑'],['left','←'],['down','↓'],['right','→']]) {
    const arrow = doc.createElement('button'); arrow.type = 'button'; arrow.textContent = label; arrow.dataset.matchDirection = direction; arrow.setAttribute('aria-label', `Move target physically ${direction}`);
    arrow.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') touches.add(event.pointerId);
      if (touches.size > 1) { cancelMotion(); return; }
      if (arrow.disabled || held !== null) return; event.preventDefault(); held = event.pointerId;
      arrow.setPointerCapture?.(event.pointerId); onAction('nudge', direction); repeat = win.setInterval(() => onAction('nudge', direction), 100);
    });
    arrow.addEventListener('click', event => { if (event.detail === 0 && !arrow.disabled) onAction('nudge', direction); }); arrows.append(arrow);
  }
  const pad = doc.createElement('div'); pad.className = 'point-match-pad'; pad.tabIndex = 0; pad.setAttribute('role', 'application'); pad.setAttribute('aria-label', 'Drag to move target'); pad.textContent = 'Drag to move target';
  pad.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') touches.add(event.pointerId); if (touches.size > 1 || !state?.anchors?.some(p=>p.id===state.selectedId)) { cancelMotion(); return; } event.preventDefault(); padPointer = { id:event.pointerId,x:event.clientX,y:event.clientY }; pad.setPointerCapture?.(event.pointerId); });
  pad.addEventListener('pointermove', event => { if (padPointer?.id !== event.pointerId) return; onAction('pad-delta', [event.clientX-padPointer.x,event.clientY-padPointer.y]);padPointer.x=event.clientX;padPointer.y=event.clientY; });
  const end = event => { touches.delete(event.pointerId); if (held === event.pointerId || padPointer?.id === event.pointerId) cancelMotion(); };
  const secondTouch = event => { if (event.pointerType==='touch') {touches.add(event.pointerId);if(touches.size>1)cancelMotion();} };
  const blur = () => {touches.clear();cancelMotion();};
  const key = event => { if (event.key === 'Escape') cancelMotion(); };
  const listeners = [[win,'pointerup',end],[win,'pointercancel',end],[win,'lostpointercapture',end],[win,'blur',blur],[doc,'keydown',key],[doc,'pointerdown',secondTouch]];
  listeners.forEach(([target,type,handler])=>target?.addEventListener?.(type,handler));
  const actions = doc.createElement('div'); actions.className = 'point-match-actions';
  actions.append(button('Confirm output identification', 'identify'), button('Record target','record'),button('Fit preview','fit'),button('Cancel','cancel'),button('Retry output','retry'));
  element.append(heading,note,status,sizes,slots,step,arrows,pad,actions);
  return {
    element,
    update(next) {
      const previousPoint=state?.anchors?.find(p=>p.id===state.selectedId),nextPoint=next?.anchors?.find(p=>p.id===next.selectedId);
      if (state && (state.selectedId !== next?.selectedId || state.phase !== next?.phase || Boolean(previousPoint)!==Boolean(nextPoint) || previousPoint?.s!==nextPoint?.s || previousPoint?.t!==nextPoint?.t)) {touches.clear();cancelMotion();} state=next;
      element.hidden=!next || next.phase==='closed';
      if (!next || next.phase==='closed') return;
      for (const [kind, select] of sizeSelects) {
        select.value = next.displayPrefs?.[`${kind}MarkerSize`] || 'medium';
        select.disabled = ['discovering', 'invalid'].includes(next.phase);
      }
      const route=next.context?.output ? `${next.context.output} logical output${next.context.displaySide ? ` · displayed ${next.context.displaySide} · ${next.context.reversed ? 'reversed' : 'normal orientation'}` : ''}` : '';
      status.textContent=[route,next.error || next.message || next.phase].filter(Boolean).join(' · ');
      const editing=['capture','checking'].includes(next.phase) && next.identified !== false;
      for (const row of slots.children) {
        const id=Number(row.dataset.matchSlot), anchor=next.anchors?.find(p=>p.id===id); row.hidden=id>4 && next.phase!=='checking';
        row.querySelector('span').textContent=anchor ? `${anchor.recorded ? 'Recorded' : 'Unrecorded'} · ${anchor.targetPx.map(n=>n.toFixed(2)).join(', ')}` : 'Pick an image feature';
        row.querySelector('[data-match-action="select"]').setAttribute('aria-pressed',String(next.selectedId===id));
        row.querySelectorAll('button').forEach(node=>node.disabled=!(editing || next.phase==='candidate-preview'));
      }
      buttons.get('record').disabled=!next.canRecord || !editing; buttons.get('fit').disabled=!next.canFit || next.fitting;
      buttons.get('identify').hidden=next.identified!==false || !next.probed; buttons.get('retry').hidden=next.phase!=='invalid';
      arrows.querySelectorAll('button').forEach(node=>node.disabled=!editing || !next.anchors?.some(p=>p.id===next.selectedId));
      pad.inert=!editing; step.disabled=!editing;
    },
    cancelMotion,
    dispose() { cancelMotion(); listeners.forEach(([target,type,handler])=>target?.removeEventListener?.(type,handler)); element.remove(); },
  };
}
