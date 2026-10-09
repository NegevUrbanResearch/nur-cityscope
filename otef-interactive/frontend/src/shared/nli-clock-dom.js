import { nliClockHalfOpacity } from './nli-clock-motion.js';

/** Persistent DOM clock; only a changing digit's glyph layers are replaced. */
export function createNliClockDomRenderer(caption) {
  const doc = caption.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'nli-tl-clock nli-tl-clock--clock-only nli-clock-motion';
  root.setAttribute('dir', 'ltr');
  root.setAttribute('role', 'img');
  caption.replaceChildren(root);
  const slots = [];

  function glyph(char) {
    const span = doc.createElement('span');
    span.className = 'nli-clock-glyph';
    span.textContent = char;
    return span;
  }

  function half(char, side, scale) {
    const span = doc.createElement('span');
    span.className = `nli-clock-half nli-clock-half--${side}`;
    span.style.transform = `scaleY(${scale})`;
    span.style.opacity = String(nliClockHalfOpacity(scale));
    span.append(glyph(char));
    return span;
  }

  function render(frame) {
    root.setAttribute('aria-label', frame.toLabel);
    for (let index = 0; index < frame.toLabel.length; index += 1) {
      const char = frame.toLabel[index];
      let slot = slots[index];
      if (!slot) {
        const el = doc.createElement('span');
        el.className = char === ':' ? 'nli-clock-digit nli-clock-digit--colon' : 'nli-clock-digit';
        el.setAttribute('aria-hidden', 'true');
        root.append(el);
        slots[index] = slot = { el, signature: '' };
      }
      const previous = frame.fromLabel[index];
      const moving = frame.active && char !== ':' && char !== previous;
      const signature = moving ? `${previous}:${char}:${frame.progress}` : char;
      if (signature === slot.signature) continue;
      slot.signature = signature;
      if (!moving) slot.el.replaceChildren(glyph(char));
      else if (frame.progress < .5) {
        slot.el.replaceChildren(half(previous, 'bottom', 1), half(previous, 'top', Math.cos(frame.progress * Math.PI)));
      } else {
        slot.el.replaceChildren(half(char, 'top', 1), half(char, 'bottom', Math.sin((frame.progress - .5) * Math.PI)));
      }
    }
  }
  return { render, isMounted: () => caption.firstElementChild === root };
}
