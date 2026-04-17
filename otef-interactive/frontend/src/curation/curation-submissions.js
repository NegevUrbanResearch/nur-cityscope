/**
 * Searchable submissions combobox (Supabase all-submissions API).
 */

import { sanitizeCssColor } from "./curation-color-utils.js";

/** Normalize submission UUID strings (API / GeoJSON casing may differ). */
function normSubmissionId(id) {
  return String(id ?? "").trim().toLowerCase();
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

/**
 * CSS classes for submission/layer type chips. Only known axis labels use type-moreshet;
 * arbitrary labels stay on the neutral base chip.
 * @param {string} tagLabel
 */
export function chipClassForTag(tagLabel) {
  const t = String(tagLabel || "").trim().toLowerCase();
  if (t === "memorials") return "curation-chip curation-chip-type type-memorial";
  if (t === "tkuma line") return "curation-chip curation-chip-type type-moreshet";
  return "curation-chip";
}

/**
 * Multiple tags per row: Tkuma Line / Memorials when applicable.
 * @param {ReturnType<normalizeSubmissionRow>} row
 * @returns {string[]}
 */
export function getSubmissionTagLabels(row) {
  const label = String(row?.typeLabel || "").toLowerCase();
  const tags = [];
  if (label.includes("mixed") || label.includes("multiple")) {
    tags.push("Tkuma Line", "Memorials");
  } else if (label.includes("memorial")) {
    tags.push("Memorials");
  } else {
    tags.push("Tkuma Line");
  }
  return tags;
}

function normalizeSubmissionRow(raw) {
  const id = normSubmissionId(raw?.id ?? raw?.submission_id ?? "");
  const name =
    raw?.name != null && String(raw.name).trim() !== ""
      ? String(raw.name).trim()
      : id.slice(0, 8) + (id.length > 8 ? "…" : "");
  const typeLabel = String(raw?.type_label ?? "Mixed").trim() || "Mixed";
  const hasHistory = Boolean(raw?.has_history);
  const colorCandidates = [
    raw?.submission_color,
    raw?.submissionColor,
    raw?.display_color,
    raw?.displayColor,
    raw?.color,
  ];
  let colorRaw = "";
  for (const c of colorCandidates) {
    if (c != null && String(c).trim() !== "") {
      colorRaw = String(c).trim();
      break;
    }
  }
  const colorCss = colorRaw ? sanitizeCssColor(colorRaw) : null;
  return { id, name, typeLabel, hasHistory, colorRaw, colorCss, raw };
}

function renderOptionChipsHtml(row) {
  const tags = getSubmissionTagLabels(row);
  return tags
    .map((tag) => {
      const cls = chipClassForTag(tag);
      return `<span class="${cls}">${escapeHtml(tag)}</span>`;
    })
    .join("");
}

/**
 * @param {object} deps
 * @param {ReturnType<import("./curation-api.js").createCurationApi>} deps.API
 * @param {() => HTMLInputElement | null} deps.getSearchInput
 * @param {() => HTMLElement | null} deps.getListContainer
 * @param {() => HTMLElement | null} deps.getComboRoot
 * @param {() => HTMLElement | null} deps.getComboField
 * @param {() => HTMLElement | null} deps.getSelectedTagsContainer
 * @param {() => HTMLInputElement | null} deps.getSelectedIdInput
 * @param {Map<string, string>} deps.submissionTypeById
 * @param {(msg: string, type?: string) => void} deps.setStatus
 * @param {() => void} [deps.updateSaveEditsState]
 * @param {(submissionId: string) => void} [deps.onSelectionChange]
 * @param {() => void} [deps.onSubmissionsLoaded] runs after each submissions fetch settles (success or handled error)
 */
export function createSubmissionsPanel(deps) {
  const {
    API,
    getSearchInput,
    getListContainer,
    getComboRoot,
    getComboField,
    getSelectedTagsContainer,
    getSelectedIdInput,
    submissionTypeById,
    setStatus,
    updateSaveEditsState = () => {},
    onSelectionChange,
    onSubmissionsLoaded,
  } = deps;

  /** @type {ReturnType<normalizeSubmissionRow>[]} */
  let submissions = [];
  /** @type {ReturnType<normalizeSubmissionRow> | null} */
  let selectedSubmission = null;
  let filterText = "";
  let listOpen = false;
  let ignoreNextInputSync = false;

  function getSelectedSubmission() {
    return selectedSubmission;
  }

  function hasSubmissionId(id) {
    const k = normSubmissionId(id);
    return submissions.some((s) => s.id === k);
  }

  function getSubmissionDisplayName(id) {
    const k = normSubmissionId(id);
    const row = submissions.find((s) => s.id === k);
    return row?.name != null ? String(row.name).trim() : "";
  }

  function getSubmissionColorCss(id) {
    const k = normSubmissionId(id);
    const row = submissions.find((s) => s.id === k);
    return row?.colorCss ?? null;
  }

  /** Match curated GIS display_name to the submissions list row (GeoJSON may omit submission_id). */
  function findSubmissionIdByDisplayName(displayName) {
    const t = String(displayName || "").trim().toLowerCase();
    if (!t) return null;
    const row = submissions.find((s) => String(s.name || "").trim().toLowerCase() === t);
    return row ? row.id : null;
  }

  function matchesFilter(row, q) {
    const t = String(q || "").trim().toLowerCase();
    if (!t) return true;
    if (row.name.toLowerCase().includes(t) || row.id.toLowerCase().includes(t)) {
      return true;
    }
    return getSubmissionTagLabels(row).some((tag) => tag.toLowerCase().includes(t));
  }

  function setListOpen(open) {
    listOpen = !!open;
    const list = getListContainer();
    const input = getSearchInput();
    const root = getComboRoot();
    if (list) {
      if (listOpen) list.removeAttribute("hidden");
      else list.setAttribute("hidden", "");
    }
    if (input) {
      input.setAttribute("aria-expanded", listOpen ? "true" : "false");
    }
    if (root) {
      root.classList.toggle("curation-submission-combo--open", listOpen);
    }
    syncSelectedTagsUi();
  }

  const SELECTED_TAGS_ID = "curationSubmissionSelectedTags";

  function syncSelectedTagsUi() {
    const tagsEl = getSelectedTagsContainer?.();
    const field = getComboField?.();
    const input = getSearchInput();
    if (!tagsEl || !field) return;
    if (!selectedSubmission) {
      tagsEl.innerHTML = "";
      field.classList.remove("has-selected-tags");
      tagsEl.setAttribute("aria-hidden", "true");
      input?.removeAttribute("aria-describedby");
      return;
    }
    const colorDot =
      selectedSubmission.colorCss != null
        ? `<span class="curation-submission-selected-swatch" style="background-color:${escapeHtml(selectedSubmission.colorCss)}" title="Submission color" aria-hidden="true"></span>`
        : "";
    tagsEl.innerHTML = colorDot + renderOptionChipsHtml(selectedSubmission);
    field.classList.add("has-selected-tags");
    if (listOpen) {
      tagsEl.setAttribute("aria-hidden", "true");
      input?.removeAttribute("aria-describedby");
    } else {
      tagsEl.setAttribute("aria-hidden", "false");
      input?.setAttribute("aria-describedby", SELECTED_TAGS_ID);
    }
  }

  function syncInputDisplayFromSelection() {
    const input = getSearchInput();
    if (!input || ignoreNextInputSync) return;
    if (!listOpen) {
      input.value = selectedSubmission ? selectedSubmission.name : "";
    }
    syncSelectedTagsUi();
  }

  function renderList() {
    const list = getListContainer();
    if (!list) return;
    const rows = submissions.filter((row) => matchesFilter(row, filterText));
    if (rows.length === 0) {
      list.innerHTML =
        '<div class="curation-status">' +
        (submissions.length === 0 ? "No submissions loaded." : "No matching submissions.") +
        "</div>";
      return;
    }
    const selectedId = normSubmissionId(getSelectedIdInput()?.value || "");
    list.innerHTML = rows
      .map((row) => {
        const selected = row.id === selectedId ? " curation-submission-option--active" : "";
        const active = row.id === selectedId ? "true" : "false";
        const chips = renderOptionChipsHtml(row);
        const colorDot =
          row.colorCss != null
            ? `<span class="curation-submission-option-swatch" style="background-color:${escapeHtml(row.colorCss)}" title="Submission color" aria-hidden="true"></span>`
            : "";
        return `<button type="button" role="option" class="curation-submission-option${selected}" data-submission-id="${escapeHtml(row.id)}" aria-selected="${active}">
          <span class="curation-submission-option-head">
            ${colorDot}
            <span class="curation-submission-option-title">${escapeHtml(row.name)}</span>
          </span>
          <span class="curation-submission-option-chips">${chips}</span>
        </button>`;
      })
      .join("");
    list.querySelectorAll(".curation-submission-option").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
      });
      btn.addEventListener("click", () => {
        const id = normSubmissionId(btn.getAttribute("data-submission-id") || "");
        selectSubmissionById(id, { notify: true });
        filterText = "";
        setListOpen(false);
        syncInputDisplayFromSelection();
        getSearchInput()?.blur();
      });
    });
  }

  /**
   * @param {string} id
   * @param {{ notify?: boolean }} [opts]
   */
  function selectSubmissionById(id, opts = {}) {
    const notify = opts.notify !== false;
    const k = normSubmissionId(id);
    const input = getSelectedIdInput();
    if (!input) return;
    if (k && !hasSubmissionId(k)) return;
    input.value = k;
    selectedSubmission = k ? submissions.find((s) => s.id === k) || null : null;
    renderList();
    syncInputDisplayFromSelection();
    updateSaveEditsState();
    if (notify && onSelectionChange) onSelectionChange(k);
  }

  function syncSearchFromInput() {
    const si = getSearchInput();
    filterText = si ? String(si.value || "") : "";
  }

  function bindCombo() {
    const input = getSearchInput();
    const root = getComboRoot();
    if (!input || input.dataset.bound === "1") return;
    input.dataset.bound = "1";

    input.addEventListener("focus", () => {
      ignoreNextInputSync = true;
      input.value = "";
      filterText = "";
      ignoreNextInputSync = false;
      setListOpen(true);
      renderList();
    });

    input.addEventListener("input", () => {
      if (!listOpen) setListOpen(true);
      syncSearchFromInput();
      renderList();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        setListOpen(false);
        syncInputDisplayFromSelection();
        input.blur();
      }
    });

    const onDocPointerDown = (e) => {
      if (!listOpen) return;
      const t = e.target;
      if (!t) return;
      if (root && root.contains(t)) return;
      setListOpen(false);
      syncInputDisplayFromSelection();
    };
    document.addEventListener("mousedown", onDocPointerDown);
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        const ae = document.activeElement;
        if (root && ae && root.contains(ae)) return;
        if (!listOpen) return;
        setListOpen(false);
        syncInputDisplayFromSelection();
      }, 0);
    });
  }

  /**
   * @param {{ preserveOnError?: boolean }} [opts]
   * When preserveOnError is true, a failed fetch leaves the previous list and selection intact
   * (used after save so a refresh glitch does not clear the picker).
   */
  async function loadSubmissions(opts = {}) {
    const preserveOnError = opts.preserveOnError === true;
    const backup = preserveOnError
      ? {
          submissions: submissions.slice(),
          selectedSubmission,
          inputValue: normSubmissionId(getSelectedIdInput()?.value || ""),
          typeEntries: Array.from(submissionTypeById.entries()),
        }
      : null;
    bindCombo();
    const list = getListContainer();
    const input = getSelectedIdInput();
    if (!list || !input) return;
    const prev = normSubmissionId(input.value || "");
    list.innerHTML = '<div class="curation-status">Loading submissions…</div>';
    submissionTypeById.clear();
    try {
      const rawList = await API.submissionsAll();
      submissions = (Array.isArray(rawList) ? rawList : [])
        .map(normalizeSubmissionRow)
        .filter((s) => s.id);
      submissions.forEach((s) => {
        submissionTypeById.set(s.id, s.typeLabel);
      });
      filterText = "";
      if (prev && hasSubmissionId(prev)) {
        input.value = prev;
        selectedSubmission = submissions.find((x) => x.id === prev) || null;
        renderList();
        syncInputDisplayFromSelection();
        updateSaveEditsState();
      } else {
        input.value = "";
        selectedSubmission = null;
        renderList();
        syncInputDisplayFromSelection();
        updateSaveEditsState();
        if (onSelectionChange) onSelectionChange("");
      }
      setListOpen(false);
    } catch (e) {
      if (backup) {
        submissions = backup.submissions;
        selectedSubmission = backup.selectedSubmission;
        input.value = backup.inputValue;
        submissionTypeById.clear();
        for (const [k, v] of backup.typeEntries) {
          submissionTypeById.set(k, v);
        }
        renderList();
        syncInputDisplayFromSelection();
        updateSaveEditsState();
        setListOpen(false);
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[curation] submissions refresh failed:", e);
        }
      } else {
        submissions = [];
        setStatus("Could not load submissions: " + (e?.message || String(e)), "error");
        input.value = "";
        selectedSubmission = null;
        renderList();
        syncInputDisplayFromSelection();
        updateSaveEditsState();
        if (onSelectionChange) onSelectionChange("");
        setListOpen(false);
      }
    } finally {
      if (typeof onSubmissionsLoaded === "function") onSubmissionsLoaded();
    }
  }

  return {
    loadSubmissions,
    selectSubmissionById,
    getSelectedSubmission,
    hasSubmissionId,
    getSubmissionDisplayName,
    getSubmissionColorCss,
    findSubmissionIdByDisplayName,
  };
}
