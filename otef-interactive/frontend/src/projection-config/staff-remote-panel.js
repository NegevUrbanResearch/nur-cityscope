function node(doc, tag, className, text = "") {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function ageText(ageMs) {
  if (!Number.isFinite(ageMs)) return "Unknown";
  if (ageMs < 1_000) return "Just now";
  return `${Math.floor(ageMs / 1_000)}s ago`;
}

export function createStaffRemotePanel({ document: doc, manager } = {}) {
  const summary = node(doc, "section", "staff-remote-summary");
  summary.setAttribute("aria-label", "Tablet remote status");
  const summaryLabel = node(doc, "strong", "staff-remote-summary-label", "Tablet remote");
  const summaryStatus = node(doc, "span", "staff-remote-summary-status", "No tablet remote detected");
  summary.append(summaryLabel, summaryStatus);

  const element = node(doc, "section", "staff-remote-panel");
  element.setAttribute("aria-label", "Tablet remote management");
  const guidance = node(doc, "p", "staff-remote-guidance", "Return GIS/projection to Home, then reload this tablet.");
  const fullscreenNote = node(doc, "small", "staff-remote-fullscreen-note", "The tablet may need a local tap to return to fullscreen.");
  const liveStatus = node(doc, "span", "staff-remote-live-status");
  liveStatus.setAttribute("role", "status");
  liveStatus.setAttribute("aria-live", "polite");
  liveStatus.setAttribute("aria-atomic", "true");
  const rows = node(doc, "div", "staff-remote-rows");
  element.append(guidance, fullscreenNote, liveStatus, rows);

  let lastStatusSignature = "";
  let disposed = false;
  const rowNodes = new Map();
  function createRow() {
    const row = node(doc, "article", "staff-remote-row");
    const heading = node(doc, "h3", "staff-remote-row-heading", "NLI staff remote");
    const details = node(doc, "dl", "staff-remote-row-details");
    const values = [];
    for (const label of ["Session", "Status", "Loaded version", "Last contact"]) {
      details.append(node(doc, "dt", "", label));
      const value = node(doc, "dd", "", ""); values.push(value); details.append(value);
    }
    const button = node(doc, "button", "", "Refresh tablet");
    button.type = "button";
    const blocked = node(doc, "p", "staff-remote-blocked-copy");
    const actionStatus = node(doc, "p", "staff-remote-action-status");
    const settling = node(doc, "p", "staff-remote-settling-copy", "If an archive request is still settling, wait before refreshing.");
    row.append(heading, details, button, blocked, actionStatus, settling);
    return { row, values, button, blocked, actionStatus, settling };
  }
  function render(state) {
    if (disposed) return;
    const remotes = state?.remotes || [];
    const statuses = remotes.map((remote) => remote.status);
    const summaryText = !remotes.length ? (state?.connectionStatus === "Connection unavailable" ? "Connection unavailable" : "No tablet remote detected") :
      statuses.includes("Online") ? `${remotes.length} tablet remote${remotes.length === 1 ? "" : "s"} · Online` : statuses[0];
    summaryStatus.textContent = summaryText;
    const signature = `${state?.connectionStatus || ""}|${remotes.map((remote) => `${remote.remoteId}:${remote.instanceId}:${remote.status}:${remote.actionStatus || ""}`).join("|")}`;
    if (signature !== lastStatusSignature) {
      liveStatus.textContent = remotes.map((remote) => [remote.sessionId, remote.status, remote.actionStatus].filter(Boolean).join(": ")).join(". ") || summaryText;
      lastStatusSignature = signature;
    }
    if (!remotes.length) {
      rowNodes.clear();
      rows.replaceChildren(node(doc, "p", "staff-remote-empty", "No tablet remote detected"));
      return;
    }
    const activeKeys = new Set();
    const elements = remotes.map((remote) => {
      const key = `${remote.remoteId}:${remote.instanceId}`;
      activeKeys.add(key);
      let parts = rowNodes.get(key);
      if (!parts) { parts = createRow(); rowNodes.set(key, parts); }
      const pairs = [["Session", remote.sessionId || remote.remoteId?.slice(0, 8) || "Unknown"], ["Status", remote.status],
        ["Loaded version", remote.version || "Version unavailable"], ["Last contact", ageText(remote.ageMs)]];
      pairs.forEach(([, value], index) => { parts.values[index].textContent = value; });
      parts.button.setAttribute("aria-label", `Refresh tablet ${remote.sessionId || "session"}`);
      parts.button.disabled = !remote.actionEnabled;
      parts.button.onclick = () => { manager.refresh(remote); };
      const blockedText = remote.blockedCopy || ({ not_home: "Return GIS/projection to Home before refreshing", busy: "Remote is busy",
        owned_session: "Close the archive or presentation before refreshing" })[remote.blockedReason] || "";
      parts.blocked.textContent = blockedText;
      parts.blocked.hidden = !blockedText;
      parts.actionStatus.textContent = remote.actionStatus || "";
      parts.actionStatus.hidden = !remote.actionStatus;
      parts.settling.hidden = !remote.archiveSettling;
      return parts.row;
    });
    for (const key of rowNodes.keys()) if (!activeKeys.has(key)) rowNodes.delete(key);
    const sameRows = rows.children.length === elements.length && elements.every((element, index) => rows.children[index] === element);
    if (!sameRows) rows.replaceChildren(...elements);
  }

  const unsubscribe = manager?.subscribe?.(render);
  render(manager?.getState?.() || { connectionStatus: "Connection unavailable", remotes: [] });
  return { summary, element, dispose() { if (disposed) return; disposed = true; unsubscribe?.(); } };
}
