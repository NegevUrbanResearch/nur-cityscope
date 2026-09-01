export function resolveMotionMode(windowLike = typeof window !== "undefined" ? window : undefined) {
  try {
    return windowLike?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
      ? "reduced"
      : "full";
  } catch {
    return "full";
  }
}
