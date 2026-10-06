import { createPointMatchSession } from './point-match-session.js';
import { discoverOutputs, monitorProjectionOutputs } from './projection-output-discovery.js';
import { fitProjectionKeystone, measureProjectionLandmarks } from '../shared/projection-point-fit.js';
import { evaluateWarpMesh } from '../shared/projection-warp-geometry.js';
import { createUuid } from '../shared/uuid.js';
import { isProjectionMatchAck } from '../shared/projection-match-protocol.js';

const clone = value => structuredClone(value);
const activePhase = phase => !['closed', 'invalid'].includes(phase);
const sameBaseline = (a, b) => a?.type === b?.type && a?.assetId === b?.assetId && a?.sha256?.toLowerCase() === b?.sha256?.toLowerCase();

/** Coordinates the existing editor, one physical browser output, and ephemeral measurements. */
export function createPointMatchController({ client, socket, sourceId, readContext, view, onCandidate = () => {}, onClose = () => {}, fit = fitProjectionKeystone } = {}) {
  let session = null, output = null, generation = 0, abort = null, monitor = null, disposed = false;
  let frozen = null, identified = false, replacing = true, fitting = false, step = 'normal', candidateMesh = null, retainedInstallation = false;
  let expectedPreview = null, previewTransition = false, publication = null, applyAdapter = null, publicationTimer = null, awaitingAppliedProbe = false;
  let appliedReceipt = null;
  let installationIdentity = null;
  let publicationRequest = null;
  let state = { phase: 'closed', anchors: [], error: null };
  let displayPrefs = { previewMarkerSize: 'medium', projectedMarkerSize: 'medium' };
  const isActive = () => activePhase(state.phase);
  const hasUnsavedMeasurements = () => !retainedInstallation && ['capture', 'candidate-preview', 'invalid'].includes(state.phase) && state.anchors.some(point => point.recorded);
  function publish(next = session?.getState() || state) {
    displayPrefs = { ...(next.displayPrefs || displayPrefs) };
    const clientState = client.getState();
    state = { ...next, installedCandidateIdentity: next.installedCandidateIdentity || installationIdentity,
      identified, fitting, step, publication: publication && { ...publication },
      canApply: Boolean(applyAdapter && !publication && !clientState.pending && !clientState.reconciliation &&
        ['candidate-preview', 'candidate-installed'].includes(next.phase) && next.previewReady),
      displayPrefs,
      previewMesh: next.phase === 'candidate-preview' && next.previewReady ? candidateMesh : next.phase === 'checking' ? next.context?.evaluatedMesh : frozen?.evaluatedMesh,
      message: !identified && next.probed ? 'Identify the physical output: cyan circle at (240, 180), yellow target 1 at (480, 270) in logical pixels. Confirm its display and orientation before capture.' : null };
    if (state.phase === 'checking' && state.context?.evaluatedMesh) state.checkpointErrors = measureProjectionLandmarks({ preparedMesh: state.context.evaluatedMesh, anchors: state.anchors.filter(p => p.id > 4 && p.recorded) });
    view.updatePointMatch?.(clone(state));
  }
  function onSessionChange(next) {
    const retiring=next.phase==='invalid' && isActive();
    publish(next);
    if (retiring) {
      ++generation;
      abort?.abort();
      monitor?.dispose();
      monitor = null;
      fitting = false;
      publication = null;
      awaitingAppliedProbe = false;
      clearTimeout(publicationTimer);
      publicationTimer = null;
      expectedPreview = null;
      previewTransition = false;
      view.cancelWarpPointer?.({reason:'match-invalid'});
      view.setPointMatchPreview?.(null);
      publish(next);
    }
  }
  function invalidate(reason) {
    if (disposed || !isActive()) return;
    ++generation;
    abort?.abort();
    monitor?.dispose();
    monitor = null;
    fitting = false;
    publication = null;
    awaitingAppliedProbe = false;
    clearTimeout(publicationTimer);
    publicationTimer = null;
    view.cancelWarpPointer?.({ reason: 'match-invalid' });
    if (session) session.invalidate(reason);
    else publish({ ...state, phase: 'invalid', error: reason });
    expectedPreview = null;
    previewTransition = false;
    view.setPointMatchPreview?.(null);
  }
  function entryError(context, clientState) {
    if (clientState.pending || clientState.previewError || clientState.connected === false || clientState.hydrating || clientState.hydrationError || clientState.reconciliation || view.hasPendingEdit?.()) return 'Finish pending edits and wait for accepted calibration before Match points.';
    if (!clientState.draft || JSON.stringify(clientState.draft) !== JSON.stringify(clientState.snapshot?.config)) return 'Apply or revert the current draft before Match points.';
    if (!context?.config?.outputs?.[output]?.warp?.enabled) return 'Enable browser warp correction before Match points.';
    if (!context.stable || !context.calibrationReady || !context.evaluatedMesh || context.preview?.stable !== true || context.preview?.failed || context.preview?.pending || context.preview?.configIdentity !== context.configIdentity) return context.preview?.error || 'Wait for landmarks and a stable preview. Narrative must be idle, slideshow stopped and names hidden locally.';
    return null;
  }
  function discoveryContextError() {
    const clientState = client.getState();
    if (clientState.live) {
      void client.setLive(false);
      return 'Live changed during Match points; restart capture with Live off.';
    }
    const next = readContext(output);
    const reason = entryError(next, clientState);
    if (reason) return reason;
    if (clientState.snapshot?.revision !== frozen.revision || JSON.stringify(clientState.snapshot?.config) !== frozen.configIdentity) {
      return 'Accepted calibration changed during output discovery; restart Match points.';
    }
    if (['output', 'revision', 'configIdentity', 'baselineIdentity', 'sourceFrameIdentity'].some(key => next[key] !== frozen[key])) {
      return 'Calibration or source changed during output discovery; restart Match points.';
    }
    if (next.preview.sourceFrameIdentity !== frozen.preview.sourceFrameIdentity) {
      return 'Effective source frame changed during output discovery; restart Match points.';
    }
    return null;
  }
  async function start(side) {
    if (disposed || !['left', 'right'].includes(side)) return false;
    if (state.phase !== 'closed' && !close()) return false;
    output = side;
    identified = false;
    replacing = true;
    frozen = null;
    candidateMesh = null;
    expectedPreview = null;
    publication = null;
    const token = ++generation;
    abort = new AbortController();
    publish({phase:'discovering',selectedId:1,anchors:[],error:null});
    try {
      await client.setLive(false);
      if (token !== generation || disposed) return false;
      const context = readContext(output), reason = entryError(context, client.getState());
      if (reason) { invalidate(reason); return false; }
      frozen = clone(context);
      monitor = monitorProjectionOutputs({ socket, onResponder: row => {
        if (!session || row.output !== output) return;
        const bound = session.getState().context;
        if (row.instanceId !== bound.instanceId) invalidate('Close extra output windows for this logical output, then retry.');
        else if (row.route !== 'browser' || !sameBaseline(row.baseline, frozen.config.outputs[output].warp.baseline)) invalidate('Output route or baseline changed. Reopen the selected browser output and restart matching.');
        else if (row.displaySide !== bound.displaySide || row.reversed !== bound.reversed) invalidate('Output orientation changed; restart Match points.');
        else if (publication && row.revision === publication.revision) {
          appliedReceipt = clone(row);
          tryConfirmAppliedGeometry();
        }
      } });
      const fresh = await discoverOutputs({socket,sourceId,timeoutMs:1000,signal:abort.signal});
      if (token !== generation || disposed) return false;
      const changed = discoveryContextError();
      if (changed) {
        invalidate(changed);
        return false;
      }
      const rows = [...fresh.values()].filter(row => row.output === output && row.revision === frozen.revision && row.route === 'browser' && sameBaseline(row.baseline, frozen.config.outputs[output].warp.baseline));
      if (rows.length !== 1) { invalidate(rows.length ? 'Close extra output windows for this logical output, then retry.' : 'Open the selected browser output, then retry Match points.'); return false; }
      if (!rows[0].success) { invalidate(rows[0].error || 'Output has not completed the accepted draw.'); return false; }
      session = createPointMatchSession({
        context: { ...frozen, sourceId, instanceId: rows[0].instanceId, displaySide: rows[0].displaySide, reversed: rows[0].reversed, requireProbe: true },
        sendCursor: message => socket.send(message),
        onChange: onSessionChange,
        initialDisplayPrefs: displayPrefs,
      });
      session.probe();
      return true;
    } catch (error) { if (token === generation && !disposed) invalidate(error.message || 'Output discovery failed'); return false; }
  }
  function contextChanged({ ownReceipt = false } = {}) {
    if (!isActive()) return;
    if (client.getState().live) {
      void client.setLive(false);
      invalidate('Live changed during Match points; restart capture with Live off.');
      return;
    }
    if (state.phase === 'discovering') {
      if (frozen) {
        const reason = discoveryContextError();
        if (reason) invalidate(reason);
      }
      return;
    }
    if (!session) return;
    const next = readContext(output), current = session.getState();
    if (publication) {
      if (ownReceipt) publication.accepted = true;
      const accepted = client.getState().snapshot;
      const baseAccepted = accepted?.revision === publication.baseRevision && JSON.stringify(accepted.config) === publication.baseIdentity;
      const candidateAccepted = publication.accepted && accepted?.revision === publication.revision && JSON.stringify(accepted.config) === publication.configIdentity;
      if (!next || ![publication.baseIdentity, publication.configIdentity].includes(next.configIdentity) ||
        !baseAccepted && !candidateAccepted || next.baselineIdentity !== frozen.baselineIdentity) {
        invalidate('Calibration changed during publication. Close matching and review the current draft.');
        return;
      }
      if (next.preview?.sourceFrameIdentity && next.preview.sourceFrameIdentity !== frozen.sourceFrameIdentity) {
        invalidate('Effective source changed during publication. Reopen the output and restart matching.');
        return;
      }
      publish();
      tryConfirmAppliedGeometry();
      return;
    }
    if (state.phase === 'candidate-installed') {
      if (next?.configIdentity !== current.installedCandidateIdentity || next.baselineIdentity !== frozen.baselineIdentity ||
        next.sourceFrameIdentity !== frozen.sourceFrameIdentity || next.revision !== frozen.revision) {
        close({ discard: true });
        return;
      }
      publish();
      return;
    }
    if (!next || next.configIdentity !== frozen.configIdentity || next.revision !== frozen.revision || next.baselineIdentity !== frozen.baselineIdentity) { invalidate('Calibration changed; restart Match points.'); return; }
    const preview = next.preview;
    if (preview?.sourceFrameIdentity && preview.sourceFrameIdentity !== frozen.sourceFrameIdentity) { invalidate('Effective source frame changed; restart Match points.'); return; }
    if (previewTransition && preview?.sentIdentity===expectedPreview && !preview.failed && !preview.error && !preview.stable) return;
    if (!next.calibrationReady || preview?.failed || !preview?.stable) { invalidate(preview?.error || 'Source frame is pending or unavailable; restart Match points.'); return; }
    const desired = expectedPreview || frozen.configIdentity;
    if (preview.configIdentity !== desired) { invalidate('Preview calibration changed; restart Match points.'); return; }
    previewTransition=false;
    if (!current.previewReady) session.setPreviewReady(true);
  }
  async function runFit() {
    if (!session?.getState().canFit || fitting) return false;
    const token = generation; fitting = true; abort?.abort(); abort = new AbortController(); publish();
    try {
      const result = await fit({ config:clone(frozen.config),output,baselineMesh:frozen.baselineMesh,anchors:session.getState().anchors,maxErrorPx:.5,signal:abort.signal });
      if (token !== generation || !isActive()) return false;
      fitting = false;
      if (!result.ok) { session.setError(result.message || result.reason); return false; }
      const warp = result.config.outputs[output].warp;
      candidateMesh = evaluateWarpMesh(warp.baseline.type === 'tdMesh' ? frozen.baselineMesh : null,warp,{side:output,schemaVersion:result.config.schemaVersion});
      expectedPreview = JSON.stringify(result.config);
      previewTransition=true;
      session.setCandidate(result); // Set phase and expected identity before synchronous preview callbacks.
      view.cancelWarpPointer?.({reason:'fit-preview'}); view.setPointMatchPreview?.(clone(result.config));
      onCandidate(clone(result),{output,candidateIdentity:expectedPreview,expectedWarpIdentity:JSON.stringify(frozen.config.outputs[output].warp)});
      return true;
    } catch (error) { if (token === generation && isActive()) { fitting=false;session.setError(error.message); } return false; }
  }
  function handleAction(action, value) {
    if (action === 'start' || action === 'retry') return start(value || output);
    if (action === 'live' && isActive()) return false;
    if (action === 'cancel') return close();
    if (!session || !isActive()) return false;
    if (action === 'preview-marker-size' || action === 'projected-marker-size') {
      return session.setMarkerSize(action === 'preview-marker-size' ? 'preview' : 'projected', value);
    }
    if (action === 'identify') { identified = session.getState().probed;session.clearIdentification();publish();return identified; }
    if (action === 'step') { if (['fast','normal','fine'].includes(value)) step=value;publish();return true; }
    if (action === 'cancel-motion') return true;
    if (action === 'fit') return runFit();
    if (action === 'apply') return applyCandidate(applyAdapter);
    if (state.phase==='candidate-preview' && ['select','replace','remove'].includes(action)) {
      expectedPreview=frozen.configIdentity;previewTransition=true;candidateMesh=null;session.resumeCapture();view.setPointMatchPreview?.(null);
    }
    if (!identified || !['capture','checking'].includes(state.phase) || fitting || client.getState().reconciliation) return false;
    if (state.phase === 'checking' && ['select', 'replace', 'remove'].includes(action) && value < 5) return false;
    if (action === 'select' || action === 'replace' || action === 'remove') {
      view.cancelWarpPointer?.({reason:'match-selection'}); replacing=action==='replace';
      return action==='remove' ? session.remove(value) : session.select(value);
    }
    const selected = session.getState().anchors.find(p=>p.id===state.selectedId);
    if (!state.previewReady) return false;
    if (action === 'preview-start') {
      if (replacing || !selected) { replacing=false;return session.pick(state.selectedId,value,session.getState().context.evaluatedMesh); }
      return session.moveTarget(value);
    }
    if (action === 'preview-move') return selected && session.moveTarget(value);
    if (action === 'record') return session.record();
    if (action === 'nudge' || action === 'pad-delta') {
      if (!selected) return false;
      let delta = action==='nudge' ? {left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[value] : view.mapPointMatchPadDelta?.(value) || value;
      if (!delta) return false;
      const scale=action==='nudge' ? {fast:10,normal:1,fine:.25}[step] : 1;
      const sign=state.context.reversed ? -1 : 1;
      return session.moveTarget(selected.targetPx.map((n,i)=>Math.min(i?1080:1920,Math.max(0,n+delta[i]*scale*sign))));
    }
    return false;
  }
  async function applyCandidate(adapter) {
    // A missing adapter must never fall through to publication of the ordinary draft.
    const clientState = client.getState();
    if (!adapter || publication || publicationRequest || clientState.pending || clientState.reconciliation || !state.previewReady ||
      !['candidate-preview', 'candidate-installed'].includes(state.phase)) return false;
    const token = generation;
    const candidate = session.getState().candidate;
    const candidateIdentity = JSON.stringify(candidate.config);
    const expectedDraft = state.phase === 'candidate-preview' ? frozen.configIdentity : state.installedCandidateIdentity;
    if (JSON.stringify(clientState.draft) !== expectedDraft || candidateIdentity !== state.candidateIdentity ||
      clientState.snapshot?.revision !== frozen.revision || JSON.stringify(clientState.snapshot.config) !== frozen.configIdentity) {
      close({ discard: true });
      return false;
    }
    publication = { token: createUuid(), configIdentity: candidateIdentity, revision: adapter.nextRevision?.() ?? frozen.revision + 1,
      baseRevision: clientState.snapshot.revision, baseIdentity: JSON.stringify(clientState.snapshot.config), accepted: false };
    // Measurement retirement must not retire an outstanding request's exact own receipt.
    const request = publication;
    publicationRequest = request;
    appliedReceipt = null;
    session.pauseCursor();
    publish();
    try {
      if (state.phase === 'candidate-preview') {
        const installed = await adapter.install({ output,
          corners: clone(candidate.config.outputs[output].warp.keystone.corners),
          expectedWarpIdentity: JSON.stringify(frozen.config.outputs[output].warp), candidateIdentity: publication.configIdentity });
        if (token !== generation || !installed || JSON.stringify(installed) !== publication.configIdentity) {
          throw new Error('Fit installation did not match the local candidate.');
        }
        installationIdentity = publication.configIdentity;
        session.transition('candidate-installed', { configIdentity: publication.configIdentity });
        retainedInstallation = true;
        view.setPointMatchPreview?.(null);
      }
      session.transition('publishing', publication);
      await adapter.publish({ output, candidateIdentity: publication.configIdentity, expectedRevision: publication.revision, publicationToken: publication.token });
      if (token !== generation) return false;
      if (!publication) return state.phase === 'checking' && installationIdentity === candidateIdentity;
      tryConfirmAppliedGeometry();
      if (publication && !awaitingAppliedProbe) publicationTimer = setTimeout(() => invalidate(
        'The fit is accepted but its output draw is unconfirmed. Reopen the selected browser output, then close matching to retry or Undo the retained fit.'), 3000);
      return true;
    } catch (error) {
      publication = null;
      appliedReceipt = null;
      if (token === generation && isActive()) {
        if (state.phase === 'publishing') {
          session.transition('candidate-installed');
          session.setError(error.message);
        } else invalidate(error.message);
      }
      return false;
    } finally {
      if (publicationRequest === request) publicationRequest = null;
    }
  }
  function ownsPublicationReceipt(nextState, receipt) {
    return Boolean(publicationRequest && receipt?.action === 'apply' && receipt.publicationToken === publicationRequest.token &&
      nextState.snapshot?.revision === publicationRequest.revision && JSON.stringify(nextState.snapshot.config) === publicationRequest.configIdentity &&
      JSON.stringify(nextState.draft) === publicationRequest.configIdentity);
  }
  function tryConfirmAppliedGeometry() {
    if (!publication || !appliedReceipt || state.phase !== 'publishing' || awaitingAppliedProbe) return false;
    if (appliedReceipt.success === false) {
      invalidate('The fit is retained but the output draw failed. Reopen the selected browser output and close matching to retry or Undo.');
      return false;
    }
    const applied = applyAdapter?.readAppliedContext?.({ output, configIdentity: publication.configIdentity, revision: publication.revision });
    if (!applied) return false;
    const bound = session.getState().context;
    return confirmAppliedGeometry({ ...applied, displaySide: bound.displaySide, reversed: bound.reversed,
      receipt: appliedReceipt, receiptToken: publication.token });
  }
  function confirmAppliedGeometry(context) {
    if (!publication || state.phase !== 'publishing' || awaitingAppliedProbe || context?.receiptToken !== publication.token) return false;
    const receipt = context.receipt;
    const bound = session.getState().context;
    if (context.configIdentity !== publication.configIdentity || JSON.stringify(context.config) !== publication.configIdentity ||
      context.revision !== publication.revision || context.stable !== true || !context.evaluatedMesh ||
      context.sourceFrameIdentity !== frozen.sourceFrameIdentity || context.baselineIdentity !== frozen.baselineIdentity ||
      context.displaySide !== bound.displaySide || context.reversed !== bound.reversed || receipt?.success !== true ||
      receipt.route !== 'browser' || receipt.output !== output || receipt.instanceId !== bound.instanceId || receipt.revision !== publication.revision ||
      receipt.displaySide !== bound.displaySide || receipt.reversed !== bound.reversed || !sameBaseline(receipt.baseline, frozen.config.outputs[output].warp.baseline)) return false;
    const anchors = session.getState().anchors;
    session.dispose();
    clearTimeout(publicationTimer);
    publicationTimer = null;
    frozen = clone(context);
    delete frozen.receipt;
    delete frozen.receiptToken;
    awaitingAppliedProbe = true;
    session = createPointMatchSession({
      context: { ...frozen, sourceId, instanceId: bound.instanceId, sessionId: createUuid(), requireProbe: true },
      initialAnchors: anchors,
      initialPhase: 'publishing',
      initialSelectedId: 5,
      initialDisplayPrefs: displayPrefs,
      sendCursor: message => socket.send(message),
      onChange: next => {
        if (awaitingAppliedProbe && next.probed && next.phase === 'publishing') {
          awaitingAppliedProbe = false;
          publication = null;
          session.transition('checking');
          view.setPointMatchPreview?.(null);
          return;
        }
        onSessionChange(next);
      },
    });
    session.probe();
    return true;
  }
  function close({discard=false}={}) {
    if (!discard && hasUnsavedMeasurements() && view.confirmDiscard?.('Discard recorded point measurements?') !== true) return false;
    ++generation;
    abort?.abort();
    abort = null;
    monitor?.dispose();
    monitor = null;
    fitting = false;
    const retain = retainedInstallation || Boolean(state.installedCandidateIdentity) || ['candidate-installed', 'publishing', 'checking'].includes(state.phase);
    session?.dispose();
    session = null;
    retainedInstallation = false;
    installationIdentity = null;
    expectedPreview = null;
    publication = null;
    appliedReceipt = null;
    awaitingAppliedProbe = false;
    clearTimeout(publicationTimer);
    publicationTimer = null;
    view.cancelWarpPointer?.({ reason: 'match-close' });
    view.setPointMatchPreview?.(null);
    publish({ phase: 'closed', anchors: [], error: null });
    onClose({ retainDraft: retain });
    return true;
  }
  const disconnected = () => invalidate('Projection output disconnected; reconnect and retry Match points.');
  socket?.on?.('otef_projection_match_ack',receiveAck);
  function receiveAck(message) {
    const current = session?.getState();
    if (awaitingAppliedProbe && isProjectionMatchAck(message) &&
      ['output', 'instanceId', 'sourceId', 'sessionId', 'revision', 'sourceFrameIdentity'].every(key => message[key] === current?.context[key]) &&
      message.sequence === current.pendingSequence &&
      (message.displaySide !== frozen.displaySide || message.reversed !== frozen.reversed)) {
      invalidate('Output orientation changed after Apply. Reopen the selected output and restart matching; the fit is retained.');
      return false;
    }
    const wasProbed = current?.probed;
    const accepted = session?.acknowledge(message) || false;
    if (accepted && !wasProbed && session?.getState().probed && !identified) session.showIdentification();
    return accepted;
  }
  socket?.on?.('disconnect',disconnected);
  return {start,handleAction,receiveAck,contextChanged,close,applyCandidate,confirmAppliedGeometry,ownsPublicationReceipt,
    getState:()=>clone(state),isActive,hasUnsavedMeasurements,invalidatePreview:invalidate,
    setApplyAdapter(adapter) { applyAdapter=adapter;publish(); },
    dispose(){if(disposed)return;close({discard:true});disposed=true;socket?.off?.('otef_projection_match_ack',receiveAck);socket?.off?.('disconnect',disconnected);},
  };
}
