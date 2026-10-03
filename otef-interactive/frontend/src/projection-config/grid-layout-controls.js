const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const percentText = (value) => (Number(value) * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

export function deriveGridSelectionIndices(grid, selection) {
  const columns = grid?.columns || 1, rows = grid?.rows || 1;
  const kind = selection?.kind || "point", index = Number(selection?.index || 0);
  return {
    rowIndex: kind === "row" ? clamp(index, 0, rows - 1) : kind === "column" ? 0 : kind === "point" ? clamp(Math.floor(index / columns), 0, rows - 1) : 0,
    columnIndex: kind === "column" ? clamp(index, 0, columns - 1) : kind === "row" ? 0 : kind === "point" ? clamp(index % columns, 0, columns - 1) : 0,
  };
}

export function createGridLayoutControls(doc, onAction = () => {}) {
  const section = doc.createElement("section");
  section.className = "warp-grid-layout-section";
  section.setAttribute("aria-label", "Grid layout");
  const heading = doc.createElement("h3"); heading.textContent = "Grid layout"; section.appendChild(heading);
  const hint = doc.createElement("p"); hint.className = "warp-grid-layout-hint"; hint.textContent = "Counts: 2–16. Boundary lines stay at 0% and 100%. Select a row or column, then click the viewer to place a line."; section.appendChild(hint);
  const fields = new Map();
  const actions = new Map();
  const committed = new WeakMap();
  const edited = new WeakSet();
  const placementAttempts = new WeakMap();
  const placementRuns = new WeakMap();
  let placementSequence = 0;
  let localErrorInput = null;
  let localErrorMessage = "";
  let latestState = null;
  let forceSync = false;
  const error = doc.createElement("p"); error.id = "warp-grid-layout-error"; error.className = "warp-grid-layout-error"; error.setAttribute("role", "alert"); error.setAttribute("aria-live", "polite"); section.appendChild(error);
  const clearInputError = (input) => {
    input.removeAttribute("aria-invalid"); input.setCustomValidity?.("");
    if (localErrorInput === input) { localErrorInput = null; localErrorMessage = ""; error.textContent = latestState?.errorMessage || ""; }
  };
  const showInputError = (input, message) => {
    localErrorInput = input; localErrorMessage = message;
    input.setAttribute("aria-invalid", "true"); input.setCustomValidity?.(message);
    error.textContent = message;
  };
  const commitPlacement = (input) => {
    if (!edited.has(input)) return true;
    if (placementRuns.has(input)) return false;
    const axis = input === addRowPosition ? "row" : "column";
    if (latestState?.placement?.axis !== axis) return false;
    if (placementAttempts.get(input) === input.value) return false;
    const number = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(number) || number <= 0 || number >= 100) {
      showInputError(input, `${axis === "row" ? "Row" : "Column"} position must be strictly between 0% and 100%.`);
      return false;
    }
    clearInputError(input);
    const attempt = input.value;
    const token = ++placementSequence;
    placementAttempts.set(input, attempt);
    placementRuns.set(input, token);
    // The placement callback runs the shared pending-edit guard itself. Temporarily
    // remove this field from that guard, then restore ownership until validation
    // either stages a candidate or rejects it.
    edited.delete(input);
    let result;
    try { result = onAction(axis === "row" ? "place-row" : "place-column", number); }
    catch (error) { edited.add(input); placementRuns.delete(input); throw error; }
    if (result && typeof result.then === "function") {
      edited.add(input);
      Promise.resolve(result).then(accepted => {
        if (placementRuns.get(input) !== token) return;
        placementRuns.delete(input);
        if (accepted) {
          edited.delete(input);
          placementAttempts.delete(input);
          clearInputError(input);
          if (latestState) update(latestState);
        }
      }, () => {
        if (placementRuns.get(input) !== token) return;
        placementRuns.delete(input);
        edited.add(input);
      });
      return false;
    }
    placementRuns.delete(input);
    if (result) {
      placementAttempts.delete(input);
      clearInputError(input);
      if (latestState) update(latestState);
      return true;
    }
    edited.add(input);
    return false;
  };
  const makeField = (name, label, { min, max, step = "1" } = {}) => {
    const wrapper = doc.createElement("label"); wrapper.className = "warp-grid-layout-field"; wrapper.append(doc.createTextNode(label));
    const input = doc.createElement("input"); input.type = "number"; input.dataset.gridLayoutField = name; input.setAttribute("aria-label", label); input.inputMode = "decimal"; input.step = step;
    input.setAttribute("aria-describedby", error.id);
    if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max);
    wrapper.appendChild(input); section.appendChild(wrapper); fields.set(name, input);
    input.addEventListener("input", () => {
      edited.add(input);
      const isPlacementField = name === "addRowPosition" || name === "addColumnPosition";
      if (isPlacementField && placementAttempts.get(input) !== input.value) {
        if (placementRuns.has(input)) {
          placementRuns.delete(input);
          onAction("placement-input", name === "addRowPosition" ? "row" : name === "addColumnPosition" ? "column" : null);
        }
        placementAttempts.delete(input);
      }
      if (input.value.trim() && Number.isFinite(Number(input.value))) clearInputError(input);
    });
    const commit = () => {
      if (!edited.has(input)) return true;
      if (name === "addRowPosition" || name === "addColumnPosition") {
        return commitPlacement(input);
      }
      edited.delete(input);
      const current = committed.get(input);
      const number = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(number)) {
        showInputError(input, `${label} must be a finite number. Restored the last valid value.`);
        input.value = String(current ?? "");
        return true;
      }
      const signature = String(number);
      if (current === signature) { clearInputError(input); return true; }
      clearInputError(input);
      committed.set(input, signature);
      onAction(name, number);
      return true;
    };
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault?.(); commit(); } });
    return input;
  };
  const rows = makeField("rows", "Rows", { min: 2, max: 16 });
  const columns = makeField("columns", "Columns", { min: 2, max: 16 });
  const sourceY = makeField("source-y", "Source Y (%)", { min: 0, max: 100, step: "any" });
  const sourceX = makeField("source-x", "Source X (%)", { min: 0, max: 100, step: "any" });
  const addRowPosition = makeField("addRowPosition", "Add row at Y (%)", { min: 0, max: 100, step: "any" });
  const addColumnPosition = makeField("addColumnPosition", "Add column at X (%)", { min: 0, max: 100, step: "any" });
  const makeAction = (label, name) => {
    const button = doc.createElement("button"); button.type = "button"; button.textContent = label; button.dataset.gridLayoutAction = name;
    button.addEventListener("click", () => {
      onAction(name, undefined);
    });
    section.appendChild(button); actions.set(name, button); return button;
  };
  makeAction("Add row", "add-row");
  makeAction("Add column", "add-column");
  makeAction("Remove row", "remove-row");
  makeAction("Remove column", "remove-column");
  makeAction("Evenly space selected axis", "even");
  makeAction("Rebuild uniform grid", "rebuild");
  function sync(input, value, signature = value, force = false) {
    const text = String(value);
    committed.set(input, String(signature));
    if (force || doc.activeElement !== input) input.value = text;
  }
  function update(state = {}) {
    latestState = state;
    const force = forceSync; forceSync = false;
    const { grid, selection, placement = null, errorMessage = "", visible = true } = state;
    section.hidden = !visible || !grid;
    if (!grid) return;
    const columnsCount = grid.columns, rowsCount = grid.rows;
    const { rowIndex, columnIndex } = deriveGridSelectionIndices(grid, selection);
    const rowAxis = grid.rowPositions || Array.from({ length: rowsCount }, (_, index) => index / (rowsCount - 1));
    const columnAxis = grid.columnPositions || Array.from({ length: columnsCount }, (_, index) => index / (columnsCount - 1));
    const rowPosition = rowAxis[clamp(rowIndex, 0, rowsCount - 1)];
    const columnPosition = columnAxis[clamp(columnIndex, 0, columnsCount - 1)];
    sync(rows, rowsCount, rowsCount, force); sync(columns, columnsCount, columnsCount, force);
    sync(sourceY, percentText(rowPosition), percentText(rowPosition), force); sync(sourceX, percentText(columnPosition), percentText(columnPosition), force);
    sourceY.disabled = rowIndex === 0 || rowIndex === rowsCount - 1;
    sourceX.disabled = columnIndex === 0 || columnIndex === columnsCount - 1;
    const defaultRow = (rowAxis[clamp(rowIndex, 0, rowsCount - 2)] + rowAxis[clamp(rowIndex + 1, 1, rowsCount - 1)]) / 2;
    const defaultColumn = (columnAxis[clamp(columnIndex, 0, columnsCount - 2)] + columnAxis[clamp(columnIndex + 1, 1, columnsCount - 1)]) / 2;
    if (force || (!edited.has(addRowPosition) && placement?.axis !== "row")) sync(addRowPosition, percentText(defaultRow), percentText(defaultRow), force);
    if (force || (!edited.has(addColumnPosition) && placement?.axis !== "column")) sync(addColumnPosition, percentText(defaultColumn), percentText(defaultColumn), force);
    for (const [name, button] of actions) {
      const axis = name.includes("column") ? columnAxis : rowAxis;
      const index = name.includes("column") ? columnIndex : rowIndex;
      const count = axis.length;
      button.disabled = (name === "remove-row" || name === "remove-column") && (index === 0 || index === count - 1 || count <= 2) || ((name === "move-row" || name === "move-column") && (index === 0 || index === count - 1));
      if (button.disabled) button.title = name.startsWith("remove") ? "Boundary grid lines are fixed; at least two lines are required." : name.startsWith("add") ? "Maximum grid count is 16." : "Boundary source positions are fixed at 0% and 100%.";
    }
    for (const [axis, input] of [["row", addRowPosition], ["column", addColumnPosition]]) input.setAttribute("aria-label", `Add ${axis} at ${axis === "row" ? "Y" : "X"} (%)${placement?.axis === axis ? "; enter a source percentage or click the viewer" : `; choose Add ${axis} to place a line`}`);
    actions.get("add-row").textContent = placement?.axis === "row" ? "Cancel row placement" : "Add row";
    actions.get("add-column").textContent = placement?.axis === "column" ? "Cancel column placement" : "Add column";
    error.textContent = errorMessage || (localErrorInput ? localErrorMessage : "");
  }
  const cancel = () => {
    for (const input of fields.values()) { edited.delete(input); placementRuns.delete(input); placementAttempts.delete(input); }
    for (const input of fields.values()) clearInputError(input);
    if (latestState) { forceSync = true; update(latestState); }
    forceSync = true;
  };
  const pendingPlacementInputs = () => [addRowPosition, addColumnPosition].filter(input => edited.has(input));
  const finishPendingEdit = () => pendingPlacementInputs().every(commitPlacement);
  return { element: section, fields, actions, update, cancel, finishPendingEdit, hasPendingEdit: () => pendingPlacementInputs().length > 0 };
}
