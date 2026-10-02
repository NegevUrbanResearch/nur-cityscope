const initial = () => ({ boundaryKey: null, mode: "follow", browseKey: null, gesture: null });

/** Keep the presenter's selected row local to the current snapshot boundary. */
export function createPresenterBrowse() {
  let state = initial();
  let valid = new Set();

  const copy = () => ({
    ...state,
    gesture: state.gesture ? { ...state.gesture } : null,
  });

  const sync = (snapshot = {}) => {
    const beats = Array.isArray(snapshot.beats) ? snapshot.beats : [];
    valid = new Set(beats.map((beat) => beat?.key).filter((key) => key != null));
    const fallback = snapshot.appliedKey ?? beats[0]?.key ?? null;
    if (state.boundaryKey !== snapshot.boundaryKey) {
      state = { ...initial(), boundaryKey: snapshot.boundaryKey ?? null, browseKey: fallback };
    } else if (state.mode === "follow") {
      state = { ...state, browseKey: fallback };
    } else if (!valid.has(state.browseKey)) {
      state = { ...state, mode: "follow", browseKey: fallback, gesture: null };
    }
    return copy();
  };

  const browse = (key) => {
    if (valid.has(key)) state = { ...state, mode: "browse", browseKey: key };
    return copy();
  };

  const begin = (pointerId) => {
    state = { ...state, gesture: { pointerId, beforeMode: state.mode, beforeKey: state.browseKey } };
  };

  const move = (key) => {
    if (state.gesture) browse(key);
  };

  const end = (pointerId) => {
    if (state.gesture?.pointerId === pointerId) state = { ...state, gesture: null };
  };

  const cancel = () => {
    if (state.gesture) {
      state = {
        ...state,
        mode: state.gesture.beforeMode,
        browseKey: state.gesture.beforeKey,
        gesture: null,
      };
    }
  };

  const follow = (snapshot) => {
    state = { ...state, mode: "follow", gesture: null };
    return sync(snapshot);
  };

  return { getState: copy, sync, browse, follow, begin, move, end, cancel };
}
