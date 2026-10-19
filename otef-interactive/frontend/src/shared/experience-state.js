const EXPERIENCES = new Set(["regular", "nli"]);
const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));

/** Missing or malformed state must not replace a confirmed activation. */
export function normalizedExperienceState(raw) {
  if (!raw || !EXPERIENCES.has(raw.active_experience) || !Number.isSafeInteger(raw.revision) || raw.revision < 0) return null;
  const sequence = raw.state_sequence ?? 0;
  if (!Number.isSafeInteger(sequence) || sequence < 0) return null;
  return {
    active_experience: raw.active_experience,
    revision: raw.revision,
    state_sequence: sequence,
    pending_transition: copy(raw.pending_transition),
    last_transition: copy(raw.last_transition),
    nli_bookmark: copy(raw.nli_bookmark),
    regular_slideshow_settings: copy(raw.regular_slideshow_settings),
  };
}

/** Order pending/cleanup/bookmark snapshots within an unchanged activation. */
export function isExperienceStateCurrentOrNewer(incoming, current) {
  const next = normalizedExperienceState(incoming);
  const previous = normalizedExperienceState(current);
  if (!next) return false;
  if (!previous) return true;
  if (next.revision !== previous.revision) return next.revision > previous.revision;
  return next.active_experience === previous.active_experience && next.state_sequence >= previous.state_sequence;
}

/** Bind controls to their application; inactive controls never adopt another mode. */
export function captureExperienceScope(state, commandExperience = null) {
  const normalized = normalizedExperienceState(state);
  return Object.freeze({
    experience: EXPERIENCES.has(commandExperience) ? commandExperience : normalized?.active_experience || "regular",
    experience_revision: normalized?.revision ?? 0,
  });
}

export function isExperienceScopeCurrent(scope, state) {
  const normalized = normalizedExperienceState(state);
  return !!normalized && scope?.experience === normalized.active_experience && scope?.experience_revision === normalized.revision;
}

/** Keep an asynchronous result attached to the command that caused it. */
export function explicitExperienceScope(value) {
  return EXPERIENCES.has(value?.experience) && Number.isSafeInteger(value?.experience_revision) && value.experience_revision >= 0
    ? { experience: value.experience, experience_revision: value.experience_revision }
    : {};
}

export function isExperienceWriteError(error) {
  return error?.status === 409 && (
    Object.prototype.hasOwnProperty.call(error.details || {}, "experience_state") ||
    ["stale_experience", "experience_mismatch", "transition_pending", "experience_required"].includes(error?.details?.reason)
  );
}
