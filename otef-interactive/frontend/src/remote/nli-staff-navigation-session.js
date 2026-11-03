import { SCRIPTS, SHOW_STEP_IDS } from "./nli-staff-script.js";

const INTENTS = new Set(["entry", "forward", "back", "jump", "reapply", "home"]);
const OPTIONAL_STORY_IDS = new Set(["sderot", "shura", "hostages"]);
const scriptById = new Map(SCRIPTS.map((script) => [script.id, script]));
const wallStep = SCRIPTS.find((script) => script.id === "show")?.steps.findIndex((step) => step.id === SHOW_STEP_IDS.WALL);
const identityStep = SCRIPTS.find((script) => script.id === "show")?.steps.findIndex((step) => step.id === SHOW_STEP_IDS.IDENTITY);

const cloneReturnTo = (returnTo) => returnTo == null ? null : { id: returnTo.id, step: returnTo.step };
const cloneRef = (scene) => scene == null ? null : {
  scriptId: scene.scriptId,
  step: scene.step,
  returnTo: cloneReturnTo(scene.returnTo),
};

function freezeRef(scene) {
  if (!scene) return null;
  if (scene.returnTo) Object.freeze(scene.returnTo);
  return Object.freeze(scene);
}

function sameScene(left, right) {
  return left?.scriptId === right?.scriptId && left?.step === right?.step;
}

function sameRef(left, right) {
  return sameScene(left, right)
    && left?.returnTo?.id === right?.returnTo?.id
    && left?.returnTo?.step === right?.returnTo?.step;
}

function validateScene(scene) {
  if (!scene || typeof scene !== "object" || typeof scene.scriptId !== "string" || !Number.isInteger(scene.step)) {
    throw new TypeError("A scene target must be a valid SceneRef");
  }
  const script = scriptById.get(scene.scriptId);
  const step = script?.steps[scene.step];
  if (!step || Array.isArray(step.branch)) throw new RangeError("A scene target must reference an authored non-junction step");
  if (scene.returnTo != null
    && (typeof scene.returnTo !== "object"
      || typeof scene.returnTo.id !== "string"
      || !Number.isInteger(scene.returnTo.step))) {
    throw new TypeError("SceneRef.returnTo must be null or a script step reference");
  }
  return cloneRef(scene);
}

function snapshot(current, backStack, visitedStoryIds, visitedScenes) {
  const state = {
    current: freezeRef(cloneRef(current)),
    backStack: backStack.map((scene) => freezeRef(cloneRef(scene))),
    visitedStoryIds: [...visitedStoryIds],
    visitedScenes: visitedScenes.map((scene) => freezeRef(cloneRef(scene))),
  };
  Object.freeze(state.backStack);
  Object.freeze(state.visitedStoryIds);
  Object.freeze(state.visitedScenes);
  return Object.freeze(state);
}

/** In-memory successful navigation state for one NLI staff remote instance. */
export function createNliStaffNavigationSession() {
  let current = null;
  let backStack = [];
  let visitedStoryIds = [];
  let visitedScenes = [];
  let activeTicket = null;
  let nextTicketId = 0;

  const getState = () => snapshot(current, backStack, visitedStoryIds, visitedScenes);

  function begin(target, intent) {
    if (!INTENTS.has(intent)) throw new RangeError(`Unknown navigation intent: ${intent}`);
    if (intent === "home") {
      if (target !== null) throw new TypeError("Home requires a null target");
    } else if (target === null) {
      throw new TypeError(`${intent} requires a scene target`);
    }
    const normalizedTarget = target === null ? null : validateScene(target);
    const ticket = Object.freeze({
      id: ++nextTicketId,
      intent,
      source: freezeRef(cloneRef(current)),
      target: freezeRef(normalizedTarget),
    });
    activeTicket = ticket;
    return ticket;
  }

  function complete(ticket) {
    if (!ticket || ticket !== activeTicket) return false;
    activeTicket = null;
    if (ticket.intent === "home") {
      current = null;
      backStack = [];
      visitedStoryIds = [];
      visitedScenes = [];
      return true;
    }

    const { intent, source, target } = ticket;
    if (intent === "back") {
      if (sameScene(backStack.at(-1), target)) backStack.pop();
    } else if (intent !== "reapply" && source && !sameScene(source, target)) {
      backStack.push(cloneRef(source));
    }

    current = cloneRef(target);
    if (!visitedScenes.some((scene) => sameRef(scene, target))) visitedScenes.push(cloneRef(target));
    if (OPTIONAL_STORY_IDS.has(target.scriptId) && !visitedStoryIds.includes(target.scriptId)) {
      visitedStoryIds.push(target.scriptId);
    }
    return true;
  }

  function abandon(ticket) {
    if (!ticket || ticket !== activeTicket) return false;
    activeTicket = null;
    return true;
  }

  function backTarget({ recoverCurrent = false } = {}) {
    if (recoverCurrent) return cloneRef(current);
    if (current?.scriptId === "show" && current.step === wallStep) {
      return sameScene(backStack.at(-1), { scriptId: "show", step: identityStep })
        ? cloneRef(backStack.at(-1))
        : { scriptId: "show", step: identityStep, returnTo: null };
    }
    return cloneRef(backStack.at(-1));
  }

  return Object.freeze({ getState, begin, complete, abandon, backTarget });
}
