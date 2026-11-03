import { afterEach, expect, test, vi } from 'vitest';
import { createFakeMapLibreMap } from '../helpers/fake-maplibre-map.js';
import { createNliSceneDisplayBinding } from '../../frontend/src/shared/nli-scene-display-binding.js';
import { getLayerLifecycleRuntime } from '../../frontend/src/shared/layer-lifecycle-fade.js';

afterEach(() => vi.useRealTimers());
test.each([false, true])('a replacement reports entry only after its initial Names batch is drawable (fail=%s)', async fail => {
  vi.useFakeTimers(); const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map), entered = vi.fn();
  let opacity = null, mounted = false;
  const dataContext = { getLayerGroups: () => [{ id: 'nli', layers: [{ id: 'people_names', enabled: true }] }], subscribe: () => () => {} };
  const binding = createNliSceneDisplayBinding({ map, dataContext, runtime,
    coordinateEntry: async (_snapshot, options, produce) => ({ ...await produce(options.signal), namesEntry: { key: 'cue-1' } }),
    applyDisplay: () => {
      runtime.registerOpacityTarget('nli.people_names', value => { opacity = value; }); mounted = true;
    },
    onSceneSettled: () => entered(opacity),
  }).catch(error => error);
  for (let i = 0; i < 25; i++) await Promise.resolve();
  expect(mounted).toBe(true); expect(opacity).toBe(0); expect(entered).not.toHaveBeenCalled();
  if (fail) runtime.markMemberFailed('nli.people_names'); else runtime.markMemberReady('nli.people_names');
  const result = await binding;
  if (fail) { expect(result).toBeInstanceOf(Error); expect(entered).not.toHaveBeenCalled(); }
  else { expect(entered).toHaveBeenCalledWith(1); result.dispose(); }
  runtime.dispose();
});
