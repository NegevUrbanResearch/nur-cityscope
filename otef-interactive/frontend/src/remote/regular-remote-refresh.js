export function isCanonicalRegularIdle(snapshot) {
  const experience = snapshot?.experience_state;
  const narrative = snapshot?.narrative_state;
  const clock = snapshot?.investigation_clock;
  if (experience?.active_experience !== "regular" || !Number.isSafeInteger(experience.revision) ||
      experience.revision < 0 || experience.pending_transition || narrative?.id !== null || clock?.phase !== "idle") return false;
  if (clock.presentationPendingUntilMs != null && (!Number.isFinite(clock.presentationPendingUntilMs) ||
      clock.presentationPendingUntilMs > Date.now())) return false;
  if (!Object.hasOwn(snapshot, "projection_slideshow")) return false;
  const slideshow = snapshot.projection_slideshow;
  return slideshow === null || slideshow?.type === "stop" ||
    (typeof slideshow === "object" && !Array.isArray(slideshow) && Object.keys(slideshow).length === 0);
}

export function getRegularRemoteRefreshState({ dataContext, busy }) {
  if (dataContext.isConnected?.() !== true) return { ready: false, refreshBlockReason: "not_ready" };
  if (busy) return { ready: true, refreshBlockReason: "busy" };
  const safe = isCanonicalRegularIdle({ experience_state: dataContext.getExperienceState?.(),
    narrative_state: dataContext.getNarrativeState?.(), investigation_clock: dataContext.getInvestigationClock?.(),
    projection_slideshow: dataContext.getProjectionSlideshow?.() });
  return { ready: true, refreshBlockReason: safe ? null : "owned_session" };
}
