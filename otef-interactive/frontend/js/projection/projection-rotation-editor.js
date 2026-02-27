(function () {
  let getModelBounds = null;
  let getDisplayedImageBounds = null;
  let rotationEditMode = false;
  let workingAngleDeg = 0;
  let dragState = null; // { startDragAngle, startWorkingAngleDeg }
  let popupEl = null;

  function configure(deps) {
    getModelBounds = deps?.getModelBounds || null;
    getDisplayedImageBounds = deps?.getDisplayedImageBounds || null;
  }

  function getModelBoundsSafe() {
    return typeof getModelBounds === "function" ? getModelBounds() : null;
  }

  function getDisplayBoundsSafe() {
    return typeof getDisplayedImageBounds === "function"
      ? getDisplayedImageBounds()
      : null;
  }

  /** Angle in degrees from display center to point (0 = up/north, 90 = right/east). */
  function angleFromCenterToPoint(cx, cy, px, py) {
    const dx = px - cx;
    const dy = py - cy;
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  }

  function normalizeAngleDelta(delta) {
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
  }

  function getCurrentAngle() {
    try {
      if (
        typeof OTEFDataContext !== "undefined" &&
        typeof OTEFDataContext.getViewerAngleDeg === "function"
      ) {
        const v = OTEFDataContext.getViewerAngleDeg();
        if (typeof v === "number" && !Number.isNaN(v)) {
          return v;
        }
      }
    } catch (_) {}

    const mb = getModelBoundsSafe();
    if (mb && typeof mb.viewer_angle_deg === "number") {
      return mb.viewer_angle_deg;
    }
    return 0;
  }

  function getCurrentPolygon() {
    try {
      if (
        typeof OTEFDataContext !== "undefined" &&
        typeof OTEFDataContext.getBounds === "function"
      ) {
        const current = OTEFDataContext.getBounds();
        if (Array.isArray(current) && current.length >= 3) {
          return current;
        }
      }
    } catch (_) {}

    const mb = getModelBoundsSafe();
    if (!mb) return null;
    return [
      { x: mb.west, y: mb.south },
      { x: mb.east, y: mb.south },
      { x: mb.east, y: mb.north },
      { x: mb.west, y: mb.north },
    ];
  }

  function setHighlightAngle(angle) {
    if (typeof window !== "undefined" && typeof window.currentOrientationDeg !== "undefined") {
      window.currentOrientationDeg = angle;
    }
  }

  function updateToolbarUI() {
    const valueEl = document.getElementById("rotationAngleValue");
    if (valueEl) {
      valueEl.textContent =
        String(Math.round(workingAngleDeg * 10) / 10) + "°";
    }
    setHighlightAngle(workingAngleDeg);
  }

  function showCursorPopup(clientX, clientY, angle) {
    if (!popupEl) {
      popupEl = document.getElementById("rotationCursorPopup");
    }
    if (popupEl) {
      popupEl.style.display = "block";
      popupEl.style.left = clientX + "px";
      popupEl.style.top = clientY - 32 + "px";
      popupEl.style.transform = "translate(-50%, 0)";
      popupEl.textContent = Math.round(angle * 10) / 10 + "°";
    }
  }

  function hideCursorPopup() {
    if (popupEl) {
      popupEl.style.display = "none";
    }
  }

  function onRotationMouseDown(e) {
    const bounds = getDisplayBoundsSafe();
    if (!bounds || dragState) return;
    const container = document.getElementById("displayContainer");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const px = e.clientX;
    const py = e.clientY;
    const angleAtCursor = angleFromCenterToPoint(cx, cy, px, py);
    dragState = {
      startDragAngle: angleAtCursor,
      startWorkingAngleDeg: workingAngleDeg,
    };
    showCursorPopup(px, py, workingAngleDeg);
    document.addEventListener("mousemove", onRotationMouseMove);
    document.addEventListener("mouseup", onRotationMouseUp);
  }

  function onRotationMouseMove(e) {
    if (!dragState) return;
    const container = document.getElementById("displayContainer");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const currentAngle = angleFromCenterToPoint(cx, cy, e.clientX, e.clientY);
    let delta = currentAngle - dragState.startDragAngle;
    delta = normalizeAngleDelta(delta);
    workingAngleDeg = dragState.startWorkingAngleDeg + delta;
    updateToolbarUI();
    showCursorPopup(e.clientX, e.clientY, workingAngleDeg);
  }

  function onRotationMouseUp() {
    document.removeEventListener("mousemove", onRotationMouseMove);
    document.removeEventListener("mouseup", onRotationMouseUp);
    dragState = null;
    hideCursorPopup();
  }

  function enterRotationEditMode() {
    if (rotationEditMode) return;
    rotationEditMode = true;
    workingAngleDeg = getCurrentAngle();

    const root = document.body;
    root.classList.add("rotation-editor-active");

    const toolbar = document.getElementById("rotationToolbar");
    if (toolbar) {
      toolbar.style.display = "block";
    }

    const applyBtn = document.getElementById("rotationApplyBtn");
    const cancelBtn = document.getElementById("rotationCancelBtn");

    if (applyBtn) {
      applyBtn.onclick = async () => {
        await applyRotation();
      };
    }
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        exitRotationEditMode(true);
      };
    }

    const container = document.getElementById("displayContainer");
    if (container) {
      container.addEventListener("mousedown", onRotationMouseDown);
    }

    updateToolbarUI();
  }

  function exitRotationEditMode(discardChanges) {
    if (!rotationEditMode) return;
    rotationEditMode = false;
    onRotationMouseUp();

    const container = document.getElementById("displayContainer");
    if (container) {
      container.removeEventListener("mousedown", onRotationMouseDown);
    }

    const root = document.body;
    root.classList.remove("rotation-editor-active");

    const toolbar = document.getElementById("rotationToolbar");
    if (toolbar) {
      toolbar.style.display = "none";
    }

    if (discardChanges) {
      const angle = getCurrentAngle();
      setHighlightAngle(angle);
    }
  }

  async function applyRotation() {
    const polygon = getCurrentPolygon();
    if (!polygon || polygon.length < 3) {
      window.alert(
        "Cannot determine current bounds polygon to save with orientation.",
      );
      return;
    }

    if (
      typeof OTEFDataContext === "undefined" ||
      typeof OTEFDataContext.saveBounds !== "function"
    ) {
      console.warn(
        "[Projection] OTEFDataContext not available; cannot save orientation",
      );
      return;
    }

    try {
      const result = await OTEFDataContext.saveBounds(
        polygon,
        workingAngleDeg,
      );
      if (!result || !result.ok) {
        console.error(
          "[Projection] Failed to save orientation:",
          result && result.error,
        );
        window.alert(
          "Failed to save orientation. See console for details.",
        );
        return;
      }
      exitRotationEditMode(false);
    } catch (err) {
      console.error("[Projection] Error while saving orientation:", err);
      window.alert("Error while saving orientation. See console for details.");
    }
  }

  function toggle() {
    if (rotationEditMode) {
      exitRotationEditMode(true);
    } else {
      enterRotationEditMode();
    }
  }

  window.ProjectionRotationEditor = {
    configure,
    toggle,
  };
})();
