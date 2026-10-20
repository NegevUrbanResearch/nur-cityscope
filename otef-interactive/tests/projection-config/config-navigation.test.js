// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { createConfigNavigation } from '../../frontend/src/projection-config/config-navigation.js';

test('diagram navigation combines content tools and routes explicit projector choices', () => {
  const onSelect = vi.fn();
  const nav = createConfigNavigation({ document, onSelect });
  document.body.append(nav.element);
  expect(nav.element.querySelectorAll('[data-config-tab]')).toHaveLength(2);
  expect(nav.element.querySelectorAll('[data-config-node]')).toHaveLength(16);
  expect(nav.element.querySelector('[data-config-node="left-output"]')).toBeNull();
  nav.select('left-fit');
  nav.element.querySelector('[data-projector="right"]').click();
  expect(onSelect).toHaveBeenLastCalledWith('right-fit');
  expect(nav.element.querySelector('[data-projector="left"]').getAttribute('aria-pressed')).toBe('true');
  nav.dispose();
});

test('returning to diagrams requires the editor to accept navigation', () => {
  const onBack = vi.fn(() => false);
  const nav = createConfigNavigation({ document, onBack });
  nav.select('left-grid');
  nav.element.querySelector('[data-config-back]').click();
  expect(onBack).toHaveBeenCalledOnce();
  expect(nav.element.dataset.view).toBe('editor');
  nav.showDiagram();
  expect(nav.element.dataset.view).toBe('diagram');
  nav.dispose();
});
