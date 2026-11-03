import { afterEach, expect, test, vi } from "vitest";
import { LayerSheetController } from "../../frontend/src/remote/layer-sheet-controller.js";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let revision = 2, active = true, release;
  const context = {
    captureExperienceScope: () => ({ experience: "regular", experience_revision: revision }),
    isExperienceScopeCurrent: scope => scope.experience_revision === revision,
    isExperienceActive: () => active,
    setLayersEnabled: vi.fn(() => new Promise(resolve => { release = () => resolve({ ok: true }); })),
    setLayerAnimations: vi.fn(async () => ({ ok: true })),
  };
  vi.stubGlobal("OTEFDataContext", context);
  const controller = Object.create(LayerSheetController.prototype);
  controller._allowedRegularLayerIds = () => new Set(["october_7th.route"]);
  controller.render = vi.fn();
  return { context, controller, release: () => release(), changeActivation() { revision += 2; }, prepareSwitch() { active = false; } };
}

test("an animation click cannot enable animation after its visibility write crosses an activation", async () => {
  const h = fixture();
  const action = h.controller.toggleLayerRowAnimations(["october_7th.route"], ["october_7th.route"], true);
  h.changeActivation();
  h.release();
  await action;
  expect(h.context.setLayerAnimations).not.toHaveBeenCalled();
});

test("preparing a switch stops the second half of an outgoing animation action", async () => {
  const h = fixture();
  const action = h.controller.toggleLayerRowAnimations(["october_7th.route"], ["october_7th.route"], true);
  h.prepareSwitch();
  h.release();
  await action;
  expect(h.context.setLayerAnimations).not.toHaveBeenCalled();
});

test("an unchanged active experience still enables visibility before animation", async () => {
  const h = fixture();
  const action = h.controller.toggleLayerRowAnimations(["october_7th.route"], ["october_7th.route"], true);
  expect(h.context.setLayerAnimations).not.toHaveBeenCalled();
  h.release();
  await action;
  expect(h.context.setLayerAnimations).toHaveBeenCalledWith(["october_7th.route"], true);
});
