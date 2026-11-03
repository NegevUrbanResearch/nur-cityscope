import { OTEF_API } from "../api-client.js";
import { captureExperienceScope, isExperienceScopeCurrent, normalizedExperienceState, isExperienceStateCurrentOrNewer } from "../experience-state.js";

export function experienceConflict(message = "The active experience changed") {
  const error = new Error(message);
  error.status = 409;
  error.details = { reason: "stale_experience" };
  return error;
}

export const experienceMethods = {
  configureCommandExperience(experience) {
    if (!["regular", "nli", null].includes(experience)) throw new TypeError("Invalid command experience");
    this._commandExperience = experience;
    this._installExperienceScope();
  },

  _installExperienceScope() {
    if (this._tableName) OTEF_API.setExperienceScope(this._tableName, () => this.captureExperienceScope());
  },

  captureExperienceScope() { return captureExperienceScope(this._experienceState, this._commandExperience); },
  getExperienceState() { return normalizedExperienceState(this._experienceState); },
  isExperienceScopeCurrent(scope) {
    return this._experienceState ? isExperienceScopeCurrent(scope, this._experienceState) : true;
  },
  isExperienceActive() {
    const state = this._experienceState;
    return !state || (!state.pending_transition && (!this._commandExperience || state.active_experience === this._commandExperience));
  },

  _setExperienceState(raw) {
    const next = normalizedExperienceState(raw);
    if (!next || !isExperienceStateCurrentOrNewer(next, this._experienceState)) return false;
    const previous = this._experienceState;
    const changedActivation = previous && (next.revision !== previous.revision || next.active_experience !== previous.active_experience);
    const enteringTransition = next.pending_transition && !previous?.pending_transition;
    if (changedActivation || enteringTransition) {
      this._velocity = { vx: 0, vy: 0 };
      this._velocityLoopActive = false;
      this._velocityGeneration = (this._velocityGeneration || 0) + 1;
      this._currentInteractionSource = null;
      this._layerOpGeneration += 1;
      this._layerGroupsReceipt += 1;
      this._animationsReceipt += 1;
      this._independentBasemapGeneration += 1;
    }
    this._experienceState = next;
    this._installExperienceScope();
    if (JSON.stringify(next) !== JSON.stringify(previous)) this._notify("experienceState", this.getExperienceState());
    return true;
  },

  _batchNotifications(operation) {
    if (this._notificationBatch) return operation();
    const pending = new Map();
    this._notificationBatch = pending;
    try { return operation(); }
    finally {
      this._notificationBatch = null;
      for (const [topic, value] of pending) this._notify(topic, value);
    }
  },

  adoptAuthoritativeSnapshot(snapshot) {
    this._applyStateFromApi(snapshot, { notify: true, hydrate: true, authoritative: true, experienceSnapshot: true });
    return this.getExperienceState();
  },

  async transitionExperience(stage, { target, expectedRevision, requestId }) {
    const snapshot = await OTEF_API.executeCommand(this._tableName, {
      action: "switch_experience", stage, target, expected_revision: expectedRevision, request_id: requestId,
    });
    this.adoptAuthoritativeSnapshot(snapshot);
    return snapshot;
  },

  async reportExperienceCleanup({ requestId, success, error }) {
    const scope = this.captureExperienceScope();
    const snapshot = await OTEF_API.executeCommand(this._tableName, {
      action: "experience_cleanup_result", request_id: requestId, display: "gis", success,
      ...(error ? { error: String(error).slice(0, 500) } : {}), ...scope,
    });
    this.adoptAuthoritativeSnapshot(snapshot);
    return snapshot;
  },

  async refreshExperienceState() {
    const snapshot = await OTEF_API.getState(this._tableName, { forceFresh: true });
    this.adoptAuthoritativeSnapshot(snapshot);
    return snapshot;
  },

  saveNliBookmark(bookmark) {
    const scope = this.captureExperienceScope();
    const generation = ++this._bookmarkGeneration;
    const intent = JSON.parse(JSON.stringify(bookmark));
    const run = async () => {
      if (!this.isExperienceScopeCurrent(scope) || scope.experience !== "nli") throw experienceConflict();
      const snapshot = await OTEF_API.updateState(this._tableName, { nli_bookmark: intent, ...scope });
      if (!this.isExperienceScopeCurrent(scope)) throw experienceConflict();
      // A bookmark acknowledgement must not replay its older scene snapshot.
      if (generation === this._bookmarkGeneration && snapshot?.experience_state) this._setExperienceState(snapshot.experience_state);
      return { ok: true, bookmark: intent };
    };
    const operation = (this._bookmarkQueue || Promise.resolve()).then(run, run);
    this._bookmarkQueue = operation.then(() => {}, () => {});
    return operation;
  },

  saveRegularSlideshowSettings(settings, { experienceScope } = {}) {
    const scope = experienceScope || this.captureExperienceScope();
    const intent = JSON.parse(JSON.stringify(settings));
    const run = async () => {
      if (scope?.experience !== "regular" || !this.isExperienceActive() || !this.isExperienceScopeCurrent(scope)) throw experienceConflict();
      const snapshot = await OTEF_API.updateState(this._tableName, { regular_slideshow_settings: intent, ...scope });
      if (!this.isExperienceActive() || !this.isExperienceScopeCurrent(scope)) throw experienceConflict();
      // Draft acknowledgements must never replay an older camera or scene.
      if (snapshot?.experience_state) this._setExperienceState(snapshot.experience_state);
      return { ok: true };
    };
    const operation = (this._slideshowSettingsQueue || Promise.resolve()).then(run, run);
    this._slideshowSettingsQueue = operation.then(() => {}, () => {});
    return operation;
  },
};
