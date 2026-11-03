import { NLI_PLAYABLE_IDS } from "../shared/nli-investigation-beats.js";
import { NLI_NOVA_STORY } from "../shared/nli-nova-story.js";
import { sha256Hex } from "../shared/sha256-hex.js";
import { nliFeatureBagsFromCache } from "./nli-timeline-transport.js";

export function presenterCopyKey(narrativeId, membership, minute) {
  if (!Number.isFinite(minute)) throw new Error("Invalid presenter minute");
  return JSON.stringify([narrativeId === "nova" ? "nova" : "generic",
    [...new Set(membership)].sort(), minute]);
}

export function getPresenterCopy(manifest, key, locale) {
  const copy = manifest?.records?.[key]?.[locale];
  if (typeof copy?.title !== "string" || !copy.title.trim()
    || typeof copy.timeLabel !== "string" || !copy.timeLabel.trim()) return null;
  const optional = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
  const result = { timeLabel: copy.timeLabel.trim(), title: copy.title.trim(),
    summary: optional(copy.summary), details: optional(copy.details) };
  if (Object.values(result).some((value) => typeof value === "string" && /&(?:amp|lt|gt|quot|#\d+|#x[\da-f]+);/i.test(value))) return null;
  return result;
}

export function validatePresenterCoverage(manifest, requests) {
  return requests.flatMap(({ narrativeId, membership, minutes }) => minutes.flatMap((minute) => {
    const key = presenterCopyKey(narrativeId, membership, minute);
    return ["he", "en"].filter((locale) => !getPresenterCopy(manifest, key, locale))
      .map((locale) => `${key}:${locale}`);
  }));
}

export function createPresenterDatasetGate({ host, manifest, onChange = () => {}, hash = sha256Hex }) {
  const verifiedHashes = new WeakMap();
  let generation = 0;
  let disposed = false;
  let state = { ready: false, error: "Presenter dataset identity is not verified", datasetVersion: manifest?.datasetVersion ?? null };
  let observedSignature = "";

  const publish = (next) => {
    state = next;
    onChange({ ...state });
  };
  const request = () => {
    const arm = host?._nliArmPayload?.() || {};
    const beats = Array.isArray(arm.beats) ? arm.beats : [];
    const novaBeats = NLI_NOVA_STORY.representativeMinutes;
    const narrativeId = arm.narrativeId === "nova" || arm.narrative === "nova"
      || (beats.length === novaBeats.length && beats.every((minute, index) => minute === novaBeats[index])) ? "nova" : null;
    const membership = [...new Set(Array.isArray(arm.visibleMembership)
      ? arm.visibleMembership.filter((id) => NLI_PLAYABLE_IDS.includes(id)) : [])].sort();
    const cache = host?._nliFeatureCache || {};
    const bags = nliFeatureBagsFromCache(cache);
    const featuresById = {
      [NLI_PLAYABLE_IDS[0]]: bags.polygonFeatures,
      [NLI_PLAYABLE_IDS[1]]: bags.lineFeatures,
      [NLI_PLAYABLE_IDS[2]]: bags.alarmFeatures,
    };
    const required = membership;
    const refs = required.map((id) => featuresById[id]);
    const signature = JSON.stringify([narrativeId, required]);
    const runtimeVersion = arm.datasetVersion ?? host?._nliDatasetVersion ?? null;
    return { narrativeId, required, refs, featuresById, signature, runtimeVersion };
  };

  const verify = async (snapshot, run) => {
    if (!manifest?.datasetVersion || !manifest?.acceptedSourceSha256 || !manifest?.requiredArtifacts) {
      return { ready: false, error: "Accepted presenter dataset identity is missing", datasetVersion: manifest?.datasetVersion ?? null };
    }
    if (snapshot.runtimeVersion && snapshot.runtimeVersion !== manifest.datasetVersion) {
      return { ready: false, error: "Presenter dataset version mismatch", datasetVersion: manifest.datasetVersion };
    }
    if (!snapshot.required.length || snapshot.refs.some((value) => !Array.isArray(value))) {
      return { ready: false, error: "Required NLI feature arrays are not loaded", datasetVersion: manifest.datasetVersion };
    }
    try {
      for (let i = 0; i < snapshot.required.length; i += 1) {
        const id = snapshot.required[i];
        const features = snapshot.refs[i];
        let digest = verifiedHashes.get(features);
        if (!digest) {
          digest = await hash(new TextEncoder().encode(JSON.stringify(features)));
          verifiedHashes.set(features, digest);
        }
        if (run !== generation || disposed) return state;
        if (digest !== manifest.requiredArtifacts[id]) {
          return { ready: false, error: `Feature hash mismatch for ${id}`, datasetVersion: manifest.datasetVersion };
        }
        const current = request();
        if (current.signature !== snapshot.signature || current.refs.some((ref, index) => ref !== snapshot.refs[index])) {
          return { ready: false, error: "NLI feature cache changed during verification", datasetVersion: manifest.datasetVersion };
        }
      }
      return { ready: true, error: null, datasetVersion: manifest.datasetVersion };
    } catch (error) {
      return { ready: false, error: `Feature verification failed: ${error?.message || error}`, datasetVersion: manifest.datasetVersion };
    }
  };

  const refresh = async () => {
    if (disposed) return state;
    const snapshot = request();
    if (snapshot.signature !== observedSignature || snapshot.refs.some((ref, index) => ref !== (state.refs || [])[index])) {
      generation += 1;
      observedSignature = snapshot.signature;
      publish({ ready: false, error: null, datasetVersion: manifest?.datasetVersion ?? null, refs: snapshot.refs });
    }
    const run = generation;
    const result = await verify(snapshot, run);
    if (run === generation && !disposed) publish({ ...result, refs: snapshot.refs });
    return state;
  };

  const getState = () => {
    if (disposed) return { ...state, ready: false };
    const snapshot = request();
    if (snapshot.signature !== observedSignature || snapshot.refs.some((ref, index) => ref !== (state.refs || [])[index])) {
      generation += 1;
      observedSignature = snapshot.signature;
      state = { ready: false, error: null, datasetVersion: manifest?.datasetVersion ?? null, refs: snapshot.refs };
      void refresh();
    }
    const { refs, ...publicState } = state;
    return { ...publicState };
  };

  return { refresh, getState, dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    state = { ...state, ready: false, error: "Presenter dataset gate disposed" };
  } };
}
