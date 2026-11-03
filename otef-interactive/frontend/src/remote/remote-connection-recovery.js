// Mobile browsers can resume with a socket still reporting OPEN or CONNECTING.
// Replace it on return, rather than waiting for a delayed transport close event.
export function bindRemoteConnectionRecovery(reconnect) {
  let wasHidden = document.visibilityState === "hidden";
  let timer = null;
  const recover = () => {
    if (document.visibilityState !== "visible") return;
    clearTimeout(timer);
    // Coalesce visibility, history restoration, and network return on wake.
    timer = setTimeout(() => {
      timer = null;
      if (document.visibilityState === "visible") reconnect();
    }, 100);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      wasHidden = true;
      clearTimeout(timer);
      timer = null;
    } else if (wasHidden) {
      wasHidden = false;
      recover();
    }
  };
  const onPageShow = (event) => { if (event.persisted) recover(); };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("online", recover);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("online", recover);
  };
}
