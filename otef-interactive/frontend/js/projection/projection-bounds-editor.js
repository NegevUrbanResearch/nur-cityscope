// Projection bounds editor
// Handles polygon editing UI and persistence

(function () {
  let getModelBounds = null;
  let getDisplayedImageBounds = null;
  let itmToDisplayPixels = null;

  let boundsEditMode = false;
  let boundsWorkingPolygon = null; // Array of { x, y } in ITM
  let boundsDragState = null; // { index, offsetX, offsetY }

  function configure(deps) {
    getModelBounds = deps?.getModelBounds || null;
    getDisplayedImageBounds = deps?.getDisplayedImageBounds || null;
    itmToDisplayPixels = deps?.itmToDisplayPixels || null;
  }

  function getModelBoundsSafe() {
    return typeof getModelBounds === "function" ? getModelBounds() : null;
  }

  function getDisplayBoundsSafe() {
    return typeof getDisplayedImageBounds === "function"
      ? getDisplayedImageBounds()
      : null;
  }

  function displayPixelsToItm(px, py) {
    const bounds = getDisplayBoundsSafe();
    const modelBounds = getModelBoundsSafe();
    if (!bounds || !modelBounds) return null;

    const pctX = (px - bounds.offsetX) / bounds.width;
    const pctY = (py - bounds.offsetY) / bounds.height;

    const x = modelBounds.west + pctX * (modelBounds.east - modelBounds.west);
    const y = modelBounds.north - pctY * (modelBounds.north - modelBounds.south);

    return { x, y };
  }

  function ensureBoundsEditorElements() {
    const svg = document.getElementById("boundsEditorOverlay");
    if (!svg) return null;
    return svg;
  }

  function getDefaultBoundsPolygon() {
    const modelBounds = getModelBoundsSafe();
    if (!modelBounds) return null;
    return [
      { x: modelBounds.west, y: modelBounds.south },
      { x: modelBounds.east, y: modelBounds.south },
      { x: modelBounds.east, y: modelBounds.north },
      { x: modelBounds.west, y: modelBounds.north },
    ];
  }

  function renderBoundsEditorPolygon() {
    const svg = ensureBoundsEditorElements();
    if (!svg) return;
    const polygon = boundsWorkingPolygon;
    const displayBounds = getDisplayBoundsSafe();
    if (!polygon || polygon.length < 2 || !displayBounds) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      return;
    }

    // Clear existing
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // SVG needs its own size to match container
    const container = document.getElementById("displayContainer");
    const rect = container.getBoundingClientRect();
    svg.setAttribute("width", rect.width);
    svg.setAttribute("height", rect.height);

    // Convert ITM vertices to pixels
    const pixelPoints = polygon
      .map((v) => (typeof itmToDisplayPixels === "function" ? itmToDisplayPixels(v.x, v.y) : null))
      .filter(Boolean);

    if (pixelPoints.length < 2) return;

    // Draw edges
    for (let i = 0; i < pixelPoints.length; i++) {
      const a = pixelPoints[i];
      const b = pixelPoints[(i + 1) % pixelPoints.length];
      const edge = document.createElementNS("http://www.w3.org/2000/svg", "line");
      edge.setAttribute("x1", a.x);
      edge.setAttribute("y1", a.y);
      edge.setAttribute("x2", b.x);
      edge.setAttribute("y2", b.y);
      edge.classList.add("bounds-edge");
      edge.dataset.edgeIndex = String(i);

      edge.addEventListener("click", (event) => {
        event.stopPropagation();
        handleBoundsEdgeClick(i);
      });

      svg.appendChild(edge);
    }

    // Draw vertices
    pixelPoints.forEach((pt, index) => {
      const vertex = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      vertex.setAttribute("cx", pt.x);
      vertex.setAttribute("cy", pt.y);
      vertex.setAttribute("r", 6);
      vertex.classList.add("bounds-vertex");
      vertex.dataset.vertexIndex = String(index);

      vertex.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startBoundsVertexDrag(event, index);
      });

      vertex.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleBoundsVertexDelete(index);
      });

      svg.appendChild(vertex);
    });
  }

  function startBoundsVertexDrag(event, index) {
    const container = document.getElementById("displayContainer");
    const rect = container.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;

    boundsDragState = {
      index,
      startX,
      startY,
    };

    const onMove = (moveEvent) => {
      if (!boundsDragState) return;
      const currentX = moveEvent.clientX - rect.left;
      const currentY = moveEvent.clientY - rect.top;
      const itm = displayPixelsToItm(currentX, currentY);
      if (!itm) return;

      boundsWorkingPolygon[boundsDragState.index] = { x: itm.x, y: itm.y };
      renderBoundsEditorPolygon();
    };

    const onUp = () => {
      boundsDragState = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleBoundsEdgeClick(edgeIndex) {
    if (!boundsWorkingPolygon || boundsWorkingPolygon.length < 2) return;

    const a = boundsWorkingPolygon[edgeIndex];
    const b = boundsWorkingPolygon[(edgeIndex + 1) % boundsWorkingPolygon.length];
    const mid = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };

    boundsWorkingPolygon.splice(edgeIndex + 1, 0, mid);
    renderBoundsEditorPolygon();
  }

  function handleBoundsVertexDelete(vertexIndex) {
    if (!boundsWorkingPolygon || boundsWorkingPolygon.length <= 3) return;
    boundsWorkingPolygon.splice(vertexIndex, 1);
    renderBoundsEditorPolygon();
  }

  function enterBoundsEditMode() {
    if (boundsEditMode) return;
    if (!getModelBoundsSafe()) {
      console.warn("[Projection] Cannot enter bounds editor: modelBounds not loaded");
      return;
    }

    const root = document.body;
    root.classList.add("bounds-editor-active");

    // Get current bounds from DataContext or fall back to rectangle
    let polygon = null;
    if (typeof OTEFDataContext !== "undefined") {
      const current = OTEFDataContext.getBounds();
      if (Array.isArray(current) && current.length >= 3) {
        polygon = current;
      }
    }
    if (!polygon) {
      polygon = getDefaultBoundsPolygon();
    }

    // Deep copy to avoid mutating live state until Apply
    boundsWorkingPolygon = polygon.map((v) => ({ x: v.x, y: v.y }));
    boundsEditMode = true;

    const toolbar = document.getElementById("boundsToolbar");
    if (toolbar) {
      toolbar.style.display = "block";
    }

    const applyBtn = document.getElementById("boundsApplyBtn");
    const resetBtn = document.getElementById("boundsResetBtn");
    const cancelBtn = document.getElementById("boundsCancelBtn");

    if (applyBtn) {
      applyBtn.onclick = async () => {
        await handleBoundsApply();
      };
    }
    if (resetBtn) {
      resetBtn.onclick = () => {
        boundsWorkingPolygon = getDefaultBoundsPolygon();
        renderBoundsEditorPolygon();
      };
    }
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        exitBoundsEditMode(true);
      };
    }

    renderBoundsEditorPolygon();
  }

  function exitBoundsEditMode(discardChanges) {
    if (!boundsEditMode) return;
    boundsEditMode = false;
    boundsWorkingPolygon = discardChanges ? null : boundsWorkingPolygon;

    const root = document.body;
    root.classList.remove("bounds-editor-active");

    const toolbar = document.getElementById("boundsToolbar");
    if (toolbar) {
      toolbar.style.display = "none";
    }

    const svg = document.getElementById("boundsEditorOverlay");
    if (svg) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
    }
  }

  async function handleBoundsApply() {
    if (!boundsWorkingPolygon || boundsWorkingPolygon.length < 3) {
      alert("Bounds polygon must have at least 3 vertices.");
      return;
    }

    if (typeof OTEFDataContext === "undefined") {
      console.warn("[Projection] OTEFDataContext not available; cannot save bounds");
      return;
    }

    try {
      const result = await OTEFDataContext.saveBounds(boundsWorkingPolygon);
      if (!result || !result.ok) {
        console.error("[Projection] Failed to save bounds:", result && result.error);
        alert("Failed to save bounds. See console for details.");
        return;
      }
      exitBoundsEditMode(false);
    } catch (err) {
      console.error("[Projection] Error while saving bounds:", err);
      alert("Error while saving bounds. See console for details.");
    }
  }

  function toggleBoundsEditMode() {
    if (boundsEditMode) {
      exitBoundsEditMode(true);
    } else {
      enterBoundsEditMode();
    }
  }

  window.ProjectionBoundsEditor = {
    configure,
    toggle: toggleBoundsEditMode,
  };
})();
