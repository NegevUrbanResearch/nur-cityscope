import { SCRIPTS } from "./nli-staff-script.js";

/**
 * Staff navigation. A step with `branch` is a junction, not a slide: the step
 * before it replaces Next with the branch narratives, and a narrative opened
 * there resumes the parent script after the junction.
 */
const isJunction = (step) => Array.isArray(step?.branch);
const scriptById = (id) => SCRIPTS.find((item) => item.id === id);

export function slideIndexes(script) {
  return script.steps.flatMap((step, index) => (isJunction(step) ? [] : [index]));
}

function landing(script, index, kind) {
  const step = script?.steps[index];
  if (!step) return { kind: "finish" };
  if (isJunction(step)) return { kind: "choose", scriptId: script.id, junction: index, ids: step.branch };
  return { kind, scriptId: script.id, step: index };
}

export function nextAction({ scriptId, step, returnTo }) {
  const script = scriptById(scriptId);
  if (step < script.steps.length - 1) return landing(script, step + 1, "step");
  if (!returnTo) return { kind: "finish" };
  return landing(scriptById(returnTo.id), returnTo.step + 1, "resume");
}

export function prevAction({ scriptId, step, returnTo }) {
  const script = scriptById(scriptId);
  for (let index = step - 1; index >= 0; index -= 1) {
    if (!isJunction(script.steps[index])) return { scriptId, step: index, returnTo };
  }
  return returnTo ? prevAction({ scriptId: returnTo.id, step: returnTo.step, returnTo: null }) : null;
}
