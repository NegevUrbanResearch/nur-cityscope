import { OTEF_MESSAGE_TYPES } from "../shared/message-protocol.js";

/** Saved independently from calibration drafts and presets. */
export function createGazaBorderVisibilityClient({ getSnapshot, writeVisible, socket = null, tableName = "otef" }) {
  let state = { visible: false, loading: true, pending: false, error: "" };
  let receipt = 0, destroyed = false;
  const listeners = new Set();
  const update = patch => {
    if (destroyed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener({ ...state });
  };
  const receive = message => {
    if (message?.table !== tableName || typeof message.gazaBorderVisible !== "boolean") return;
    receipt += 1;
    update({ visible: message.gazaBorderVisible, loading: false, error: "" });
  };
  const event = OTEF_MESSAGE_TYPES.GAZA_BORDER_VISIBILITY_CHANGED;
  socket?.on?.(event, receive);

  const client = {
    getState: () => ({ ...state }),
    subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); },
    async hydrate() {
      const before = receipt;
      update({ loading: true, error: "" });
      try {
        const snapshot = await getSnapshot();
        if (before === receipt) update({ visible: snapshot.gaza_border_visible === true });
      } catch (error) { update({ error: error.message || "Could not load the setting" }); }
      finally { update({ loading: false }); }
    },
    async setVisible(visible) {
      if (destroyed || state.pending || state.loading) return { ok: false };
      const before = receipt;
      update({ pending: true, requestedVisible: visible === true, error: "" });
      try {
        const response = await writeVisible(visible === true);
        if (typeof response?.gaza_border_visible !== "boolean") throw new Error("Visibility setting was not acknowledged");
        if (before === receipt) { receipt += 1; update({ visible: response.gaza_border_visible }); }
        return { ok: true };
      } catch (error) {
        update({ error: error.message || "Could not save the setting" });
        return { ok: false };
      } finally { update({ pending: false }); }
    },
    destroy() { destroyed = true; socket?.off?.(event, receive); socket?.off?.("connect", onConnect); listeners.clear(); },
  };
  const onConnect = () => { void client.hydrate(); };
  socket?.on?.("connect", onConnect);
  return client;
}
