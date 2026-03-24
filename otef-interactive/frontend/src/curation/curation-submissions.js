/**
 * Load combined submissions dropdown across Supabase projects.
 */

import {
  getSubmissionDisplayName,
  inferSubmissionTypeLabel,
} from "./curation-state.js";

/**
 * @param {object} deps
 * @param {ReturnType<import("./curation-api.js").createCurationApi>} deps.API
 * @param {() => HTMLSelectElement | null} deps.submissionSelect
 * @param {Map<string, string>} deps.submissionTypeById
 * @param {(msg: string, type?: string) => void} deps.setStatus
 * @param {(submissionId: string) => void} deps.updateSubmissionTypeBadge
 * @param {() => void} deps.updateSaveEditsState
 */
export function createLoadSubmissions(deps) {
  const {
    API,
    submissionSelect,
    submissionTypeById,
    setStatus,
    updateSubmissionTypeBadge,
    updateSaveEditsState,
  } = deps;

  return async function loadSubmissions() {
    const subSelect = submissionSelect();
    if (!subSelect) return;
    subSelect.disabled = true;
    const current = subSelect.value;
    subSelect.innerHTML = '<option value="">— Select submission —</option>';
    submissionTypeById.clear();
    try {
      const projects = await API.projects();
      const projectRows = (Array.isArray(projects) ? projects : []).map((p) => ({
        id: p.id ?? p.project_id ?? p,
        name: p.name ?? p.display_name ?? "",
      }));
      const settled = await Promise.allSettled(
        projectRows.map((p) => API.submissions(p.id))
      );
      const seenSubmissionIds = new Set();
      const submissionOrder = [];
      const submissionProjectNames = new Map();
      projectRows.forEach((project, index) => {
        const item = settled[index];
        if (!item || item.status !== "fulfilled") return;
        (item.value || []).forEach((s) => {
          const submissionId = String(s.id ?? s.submission_id ?? s);
          if (!submissionId) return;
          const names = submissionProjectNames.get(submissionId) || [];
          names.push(String(project.name || ""));
          submissionProjectNames.set(submissionId, names);
          if (!seenSubmissionIds.has(submissionId)) {
            seenSubmissionIds.add(submissionId);
            submissionOrder.push(submissionId);
          }
        });
      });

      submissionOrder.forEach((submissionId) => {
        const displayName = getSubmissionDisplayName(submissionId);
        const names = submissionProjectNames.get(submissionId) || [];
        const typeLabel = inferSubmissionTypeLabel(names);
        submissionTypeById.set(submissionId, typeLabel);
        const opt = document.createElement("option");
        opt.value = submissionId;
        opt.textContent = `[${typeLabel}] ${displayName}`;
        subSelect.appendChild(opt);
      });
      if (current && seenSubmissionIds.has(String(current))) {
        subSelect.value = String(current);
      }
      subSelect.disabled = false;
      updateSubmissionTypeBadge(subSelect.value);
      updateSaveEditsState();
    } catch (e) {
      setStatus("Could not load submissions: " + e.message, "error");
      subSelect.disabled = false;
      updateSubmissionTypeBadge("");
      updateSaveEditsState();
    }
  };
}
