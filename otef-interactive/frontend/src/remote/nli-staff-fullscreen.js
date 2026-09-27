export function createStaffFullscreenControl({ root, button, status, labels } = {}) {
  if (!root || !button || !status) return { render() {}, destroy() {} };

  const supported = typeof root.requestFullscreen === "function" && typeof document.exitFullscreen === "function";
  let failed = false;

  function render() {
    const active = document.fullscreenElement === root;
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? labels.exit : labels.enter);
    if (!supported || failed) {
      status.textContent = labels.unavailable;
      status.hidden = false;
    }
  }

  async function toggle() {
    failed = false;
    status.textContent = "";
    status.hidden = true;
    if (!supported) {
      failed = true;
      render();
      return;
    }
    try {
      if (document.fullscreenElement === root) await document.exitFullscreen();
      else await root.requestFullscreen();
      render();
    } catch {
      failed = true;
      render();
    }
  }

  button.disabled = !supported;
  if (!supported) {
    status.textContent = labels.unavailable;
    status.hidden = false;
  }
  button.addEventListener("click", toggle);
  document.addEventListener("fullscreenchange", render);
  render();

  return {
    render,
    destroy() {
      button.removeEventListener("click", toggle);
      document.removeEventListener("fullscreenchange", render);
    },
  };
}
