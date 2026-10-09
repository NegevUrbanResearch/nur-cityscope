import Reveal from "../../vendor/reveal.js/reveal.esm.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";

const REVEAL_OPTIONS = Object.freeze({
  embedded: true,
  controls: false,
  progress: false,
  keyboard: false,
  touch: false,
  hash: false,
  transition: "none",
  backgroundTransition: "none",
  width: 960,
  height: 540,
  margin: 0,
  maxScale: 4,
});

const IMAGE_READY_MS = 1500;
const FADE_MS = 600;
const OPEN_DEADLINE_MS = 4500;

function mediaUrl(path) {
  return `/otef-interactive/public/${path}`;
}

function imageAssetPath(manifest, path) {
  const version = manifest.deck.assetVersion ?? manifest.deck.pdfSha256;
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}

function slideImagePath(manifest, slide) {
  const path = manifest.deck.slidePaths?.[slide - 1] ??
    manifest.deck.slidePathPattern.replace("{slide}", String(slide).padStart(2, "0"));
  return imageAssetPath(manifest, path);
}

function stopVideo(video) {
  if (!video?.hasAttribute("src")) return;
  try { video.pause(); } catch (_) { /* The media element may not have started. */ }
  video.removeAttribute("src");
  video.preload = "none";
  try { video.load(); } catch (_) { /* Teardown must not block replacement. */ }
}

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function nextHandledExitRevision(handledExitRevision, state) {
  const handled = Number.isInteger(handledExitRevision) ? handledExitRevision : 0;
  if (!state || state.id !== null || state.transition !== "exit" || !Number.isInteger(state.revision) || state.revision <= handled) {
    return { handledExitRevision: handled, fresh: false };
  }
  return { handledExitRevision: state.revision, fresh: true };
}

export function shouldCloseViewerForNarrative({ handledExitRevision = 0, state, segment, namesWallActive = false } = {}) {
  const next = nextHandledExitRevision(handledExitRevision, state);
  if (next.fresh) {
    const keepsFixedScreen = namesWallActive && ["names_wall", "credits"].includes(segment?.id);
    return { ...next, close: !keepsFixedScreen };
  }
  if (state?.id === null && state?.transition === "exit") return { ...next, close: false };
  const mismatched = Boolean(segment?.requiredNarrative) && state?.id !== segment.requiredNarrative;
  return { ...next, close: mismatched };
}

function isValidatedClose(command) {
  return typeof command?.segmentId === "string" && command.segmentId.length > 0 &&
    typeof command.presentationSessionId === "string" && command.presentationSessionId.length > 0 &&
    Number.isInteger(command.presentationGeneration) && command.presentationGeneration > 0 &&
    Number.isInteger(command.sequence) && command.sequence > 0;
}

export function createNliRevealPresentation(container, {
  manifest,
  RevealClass = Reveal,
  emitResult = () => {},
  onVideoPlaybackChange = () => {},
} = {}) {
  let highestGeneration = 0;
  let active = null;
  let outgoing = null;
  let staged = null;
  let sceneCommand = null;
  let operationToken = 0;
  let disposed = false;
  const emitted = new WeakSet();

  const emit = (command, outcome, state = active, message = undefined) => {
    const segment = state?.segment;
    emitResult({
      segmentId: command.segmentId,
      presentationSessionId: command.presentationSessionId,
      presentationGeneration: command.presentationGeneration,
      sequence: command.sequence,
      requestId: command.requestId,
      outcome,
      slide: state?.slide ?? null,
      range: segment ? [...segment.range] : null,
      ...(message ? { message } : {}),
    });
  };

  const emitOnce = (command, outcome, state = active, message = undefined) => {
    if (!command || disposed || emitted.has(command)) return false;
    emitted.add(command);
    emit(command, outcome, state, message);
    return true;
  };

  const isCurrent = (state, token) => Boolean(state) && (active === state || staged === state) && state.token === token && !disposed;

  const cancelPending = (state) => {
    if (!state?.cancels) return;
    const pending = state.cancels.splice(0);
    for (const cancel of pending) {
      try { cancel(); } catch (_) { /* A stale callback must not block the replacement. */ }
    }
  };

  const listen = (state, token, cancel) => {
    if (!isCurrent(state, token)) {
      cancel();
      return () => {};
    }
    state.cancels.push(cancel);
    return () => {
      const index = state.cancels.indexOf(cancel);
      if (index >= 0) state.cancels.splice(index, 1);
    };
  };

  const beginOperation = (state) => {
    const token = ++operationToken;
    state.token = token;
    cancelPending(state);
    return token;
  };

  const removeState = (state, { mediaStopped = false } = {}) => {
    if (!state) return;
    clearTimeout(state.deadlineTimer);
    cancelPending(state);
    for (const video of state.overlay.querySelectorAll("video")) stopStateVideo(state, video, { mediaStopped });
    try { state.reveal?.destroy?.(); } catch (_) { /* Keep GIS usable if Reveal teardown fails. */ }
    state.overlay.remove();
    if (sceneCommand?.presentationSessionId === state.sessionId &&
        sceneCommand?.presentationGeneration === state.generation) sceneCommand = null;
    if (active === state) active = null;
    if (staged === state) staged = null;
  };

  const clearOutgoing = () => {
    if (outgoing) removeState(outgoing);
    outgoing = null;
  };

  const completeOpen = (state) => {
    state.opened = true; sceneCommand = state.command;
    clearOutgoing();
  };

  const setPlaybackActive = (state, nextActive) => {
    if (state.playbackActive === nextActive) return;
    state.playbackActive = nextActive;
    try { onVideoPlaybackChange(nextActive); } catch (_) { /* Playback remains usable if state sync fails. */ }
  };

  const stopStateVideo = (state, video, { mediaStopped = false } = {}) => {
    if (!video) return;
    if (state.currentVideo === video) {
      setPlaybackActive(state, false);
      state.videoActivation += 1;
      for (const [type, listener] of state.videoListeners || []) video.removeEventListener(type, listener);
      state.videoListeners = null;
      state.currentVideo = null;
    }
    if (!mediaStopped) stopVideo(video);
  };

  const restoreOutgoing = () => {
    if (!outgoing) return;
    active = outgoing; outgoing = null;
    active.closing = false;
    active.overlay.classList.replace("nli-reveal-outgoing", "nli-reveal-overlay");
    sceneCommand = active.command;
  };
  const fail = (command, state, token, message) => {
    if (!state || state.token !== token || (active !== state && staged !== state) || disposed || emitted.has(command)) return;
    clearTimeout(state.deadlineTimer);
    const candidate = staged === state;
    removeState(state);
    if (!candidate && state.managedScene) restoreOutgoing();
    sceneCommand = active?.command || null;
    emitOnce(command, "unavailable", state, message);
  };

  const boundOperation = (command, state, token, message) => {
    clearTimeout(state.deadlineTimer);
    state.deadlineAt = Date.now() + OPEN_DEADLINE_MS;
    state.deadlineTimer = setTimeout(() => fail(command, state, token, message), OPEN_DEADLINE_MS);
  };

  const prepareVideo = (state, video) => {
    if (!video || video.hasAttribute("src")) return;
    state.currentVideo = video;
    setPlaybackActive(state, true);
    video.preload = "auto";
    video.src = video.dataset.mediaSource;
  };

  const nextFrame = (state, token) => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      drop();
      resolve(isCurrent(state, token));
    };
    const id = requestAnimationFrame(() => finish());
    let drop = () => {};
    drop = listen(state, token, () => {
      cancelAnimationFrame(id);
      finish();
    });
  });

  const waitForOpacity = (state, token) => new Promise((resolve) => {
    const overlayNode = state.overlay;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      overlayNode.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      drop();
      resolve(Boolean(ok) && isCurrent(state, token));
    };
    const onEnd = (event) => {
      if (event.target !== overlayNode || event.propertyName !== "opacity") return;
      finish(true);
    };
    overlayNode.addEventListener("transitionend", onEnd);
    const timer = setTimeout(() => finish(true), FADE_MS);
    let drop = () => {};
    drop = listen(state, token, () => finish(false));
  });

  const fadeOverlay = async (state, token, opacity) => {
    if (!isCurrent(state, token)) return false;
    if (resolveMotionMode() === "reduced") {
      state.overlay.style.transition = "none";
      state.overlay.style.opacity = String(opacity);
      return nextFrame(state, token);
    }
    const from = opacity > 0 ? "0" : "1";
    state.overlay.style.transition = "none";
    state.overlay.style.opacity = from;
    void getComputedStyle(state.overlay).opacity;
    const framed = await nextFrame(state, token);
    if (!framed || !isCurrent(state, token)) return false;
    state.overlay.style.transition = "";
    state.overlay.style.opacity = String(opacity);
    return waitForOpacity(state, token);
  };

  const waitForImage = (state, token, slide, imageOverride) => {
    const image = imageOverride || state.sections.get(slide)?.querySelector("img");
    if (!image) return Promise.resolve(false);
    if (typeof image.decode === "function") {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (loaded) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          drop();
          resolve(Boolean(loaded) && isCurrent(state, token));
        };
        const timer = setTimeout(() => finish(false), IMAGE_READY_MS);
        let drop = () => {};
        drop = listen(state, token, () => finish(false));
        image.decode().then(() => finish(true)).catch(() => finish(false));
      });
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (loaded) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
        drop();
        resolve(Boolean(loaded) && isCurrent(state, token));
      };
      const onLoad = () => finish(true);
      const onError = () => finish(false);
      const timer = setTimeout(() => finish(false), IMAGE_READY_MS);
      let drop = () => {};
      drop = listen(state, token, () => finish(false));
      if (image.complete) {
        finish(image.naturalWidth > 0);
        return;
      }
      image.addEventListener("load", onLoad, { once: true });
      image.addEventListener("error", onError, { once: true });
    });
  };

  const startVideo = (state, token, video) => {
    if (state.currentVideo && state.currentVideo !== video) stopStateVideo(state, state.currentVideo);
    prepareVideo(state, video);
    state.currentVideo = video;
    const activation = ++state.videoActivation;
    setPlaybackActive(state, true);
    const isCurrentVideo = () => !disposed && active === state &&
      state.currentVideo === video && state.videoActivation === activation;
    const listeners = [
      ["play", () => { if (isCurrentVideo() && !video.paused && !video.ended) setPlaybackActive(state, true); }],
      ["playing", () => { if (isCurrentVideo() && !video.paused && !video.ended) setPlaybackActive(state, true); }],
      ["pause", () => { if (isCurrentVideo() && video.paused) setPlaybackActive(state, false); }],
      ["ended", () => { if (isCurrentVideo()) setPlaybackActive(state, false); }],
      ["error", () => { if (isCurrentVideo()) setPlaybackActive(state, false); }],
      ["abort", () => { if (isCurrentVideo()) setPlaybackActive(state, false); }],
      ["emptied", () => { if (isCurrentVideo()) setPlaybackActive(state, false); }],
    ];
    state.videoListeners = listeners;
    for (const [type, listener] of listeners) video.addEventListener(type, listener);
    video.muted = false;
    let playback;
    try {
      playback = video.play();
    } catch (error) {
      playback = Promise.reject(error);
    }
    const settled = Promise.resolve(playback).then(() => true).catch(() => false);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok, { release = true } = {}) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        drop();
        if (release && isCurrentVideo() && (!ok || video.paused || video.ended)) setPlaybackActive(state, false);
        resolve(Boolean(ok) && isCurrent(state, token));
      };
      const timer = setTimeout(() => finish(false), Math.max(0, state.deadlineAt - Date.now()));
      let drop = () => {};
      drop = listen(state, token, () => finish(false, { release: false }));
      settled.then((ok) => {
        if (isCurrentVideo() && ok && !video.paused && !video.ended) setPlaybackActive(state, true);
        finish(ok);
      });
    });
  };

  const activateSlide = async (command, state, token, slide, outcome) => {
    const video = state.sections.get(slide)?.querySelector("video");
    prepareVideo(state, video);
    const loaded = await waitForImage(state, token, slide);
    if (!isCurrent(state, token)) return;
    if (!loaded) {
      fail(command, state, token, "Presentation slide image could not be loaded");
      return;
    }
    if (video) {
      const started = await startVideo(state, token, video);
      if (!isCurrent(state, token)) return;
      if (!started) {
        fail(command, state, token, "Presentation video playback is unavailable");
        return;
      }
    }
    if (!isCurrent(state, token)) return;
    clearTimeout(state.deadlineTimer);
    emitOnce(command, outcome, state);
  };

  const buildOverlay = (segment) => {
    const overlay = element("div", "nli-reveal-overlay");
    overlay.style.opacity = "0";
    if (segment.kind === "blackout") {
      overlay.classList.add("nli-reveal-overlay--blackout");
      const backgroundUrl = mediaUrl(imageAssetPath(manifest, "local/presentations/nli/supplements/slide-background.png"));
      overlay.style.backgroundImage = `url("${backgroundUrl}")`;
      const copy = element("div", "nli-blackout-copy");
      const title = element("p", "nli-blackout-title");
      title.lang = "he";
      title.dir = "rtl";
      title.textContent = "מאגר הזהויות";
      const date = element("p", "nli-blackout-date");
      date.lang = "he";
      date.dir = "rtl";
      date.textContent = "ארכיון 7 באוקטובר";
      copy.append(title, date);
      overlay.append(copy);
      container.append(overlay);
      return { overlay, backgroundUrl, revealRoot: null, sections: new Map(), cancels: [] };
    }
    const revealRoot = element("div", "reveal");
    const slides = element("div", "slides");
    const sections = new Map();

    for (let number = segment.range[0]; number <= segment.range[1]; number += 1) {
      const section = element("section");
      section.dataset.slide = String(number);
      const frame = element("div", "nli-presentation-frame");
      const image = element("img");
      image.src = mediaUrl(slideImagePath(manifest, number));
      image.alt = `Slide ${number}`;
      frame.append(image);
      const videoSpec = manifest.videos.find((video) => video.slide === number);
      if (videoSpec) {
        if (videoSpec.title) {
          const title = element("h2", "nli-presentation-title");
          title.lang = "he";
          title.dir = "rtl";
          title.textContent = videoSpec.title;
          frame.append(title);
        }
        if (videoSpec.credit) {
          const credit = element("p", "nli-presentation-credit");
          credit.lang = "he";
          credit.dir = "rtl";
          const source = element("strong");
          source.textContent = videoSpec.credit;
          credit.append(source);
          if (videoSpec.photographer) {
            const photographer = element("span");
            photographer.textContent = `צילם ${videoSpec.photographer}`;
            credit.append(photographer);
          }
          frame.append(credit);
        }
        const video = element("video");
        video.dataset.mediaSource = mediaUrl(videoSpec.path);
        video.controls = false;
        video.playsInline = true;
        video.preload = "none";
        if (videoSpec.fit === "contain") video.style.objectFit = "contain";
        const [x, y, width, height] = videoSpec.rect;
        video.style.left = `${x * 100}%`;
        video.style.top = `${y * 100}%`;
        video.style.width = `${width * 100}%`;
        video.style.height = `${height * 100}%`;
        frame.append(video);
      }
      section.append(frame);
      slides.append(section);
      sections.set(number, section);
    }

    revealRoot.append(slides);
    overlay.append(revealRoot);
    container.append(overlay);
    return { overlay, revealRoot, sections, cancels: [] };
  };

  const open = async (command) => {
    const generation = command.presentationGeneration;
    if (!Number.isInteger(generation) || generation <= highestGeneration) {
      emitOnce(command, "ignored", active);
      return;
    }
    highestGeneration = generation;
    const segment = manifest?.segments?.find((candidate) => candidate.id === command.segmentId);
    if (!segment) {
      emitOnce(command, "unavailable", null, "Unknown presentation segment");
      return;
    }
    if (active) {
      const fixedSceneSwap = active.opened &&
        [active.segment.id, segment.id].every((id) => ["names_wall", "credits"].includes(id));
      if (fixedSceneSwap) {
        clearOutgoing();
        outgoing = active;
        clearTimeout(outgoing.deadlineTimer);
        cancelPending(outgoing);
        outgoing.overlay.classList.replace("nli-reveal-overlay", "nli-reveal-outgoing");
      } else {
        removeState(active);
      }
    }
    const state = {
      ...buildOverlay(segment),
      command, segment,
      reveal: null,
      slide: segment.range[0],
      sessionId: command.presentationSessionId,
      generation,
      lastSequence: command.sequence,
      token: 0,
      deadlineTimer: null,
      playbackActive: false,
      currentVideo: null,
      videoListeners: null,
      videoActivation: 0,
    };
    active = state;
    const token = beginOperation(state);
    boundOperation(command, state, token, "Presentation open timed out");
    try {
      if (segment.kind === "blackout") {
        const faded = await fadeOverlay(state, token, 1);
        if (!isCurrent(state, token) || !faded) return;
        clearTimeout(state.deadlineTimer);
        completeOpen(state);
        emitOnce(command, "opened", state);
        emit(command, "ready", state);
        return;
      }
      prepareVideo(state, state.sections.get(state.slide)?.querySelector("video"));
      state.reveal = new RevealClass(state.revealRoot, { ...REVEAL_OPTIONS });
      let initError = null;
      let initPromise;
      try {
        initPromise = Promise.resolve(state.reveal.initialize());
      } catch (error) {
        initPromise = Promise.reject(error);
      }
      const initialized = await Promise.race([
        initPromise.then(() => true).catch((error) => {
          initError = error;
          return false;
        }),
        new Promise((resolve) => { listen(state, token, () => resolve("cancelled")); }),
      ]);
      if (!isCurrent(state, token)) return;
      if (initialized !== true) {
        fail(command, state, token, initError?.message || "Presentation viewer could not be initialized");
        return;
      }
      const loaded = await waitForImage(state, token, state.slide);
      if (!isCurrent(state, token)) return;
      if (!loaded) {
        fail(command, state, token, "Presentation slide image could not be loaded");
        return;
      }
      const faded = await fadeOverlay(state, token, 1);
      if (!isCurrent(state, token) || !faded) return;
      const video = state.sections.get(state.slide)?.querySelector("video");
      if (video) {
        const started = await startVideo(state, token, video);
        if (!isCurrent(state, token)) return;
        if (!started) {
          fail(command, state, token, "Presentation video playback is unavailable");
          return;
        }
      }
      if (!isCurrent(state, token)) return;
      clearTimeout(state.deadlineTimer);
      completeOpen(state);
      emitOnce(command, "opened", state);
    } catch (error) {
      if (!isCurrent(state, token)) return;
      fail(command, state, token, error?.message || "Presentation viewer could not be initialized");
    }
  };

  const openManaged = async (command, { signal } = {}) => {
    if (signal?.aborted) return;
    if (!Number.isInteger(command.presentationGeneration) || command.presentationGeneration <= highestGeneration) {
      emitOnce(command, "ignored", active); return;
    }
    highestGeneration = command.presentationGeneration;
    const segment = manifest?.segments?.find(value => value.id === command.segmentId);
    if (!segment) { emitOnce(command, "unavailable", null, "Unknown presentation segment"); return; }
    if (staged) removeState(staged);
    const state = { ...buildOverlay(segment), command, segment, managedScene: true, reveal: null,
      slide: segment.range[0], sessionId: command.presentationSessionId,
      generation: command.presentationGeneration, lastSequence: command.sequence,
      token: 0, playbackActive: false, currentVideo: null, videoListeners: null, videoActivation: 0 };
    staged = state; sceneCommand = command;
    const token = beginOperation(state);
    boundOperation(command, state, token, "Presentation open timed out");
    if (signal) {
      const abort = () => {
        if (state.opened || !isCurrent(state, token)) return;
        const candidate = staged === state;
        removeState(state);
        if (!candidate) restoreOutgoing();
        sceneCommand = active?.command || null;
      };
      signal.addEventListener("abort", abort, { once: true });
      listen(state, token, () => signal.removeEventListener("abort", abort));
    }
    try {
      if (segment.kind === "blackout") {
        const background = element("img");
        background.src = state.backgroundUrl;
        if (!await waitForImage(state, token, state.slide, background)) {
          fail(command, state, token, "Presentation background image could not be loaded"); return;
        }
      } else {
        state.reveal = new RevealClass(state.revealRoot, { ...REVEAL_OPTIONS });
        await Promise.race([
          Promise.resolve(state.reveal.initialize()),
          new Promise(resolve => listen(state, token, resolve)),
        ]);
        if (!isCurrent(state, token)) return;
        if (!await waitForImage(state, token, state.slide)) {
          fail(command, state, token, "Presentation slide image could not be loaded"); return;
        }
        const video = state.sections.get(state.slide)?.querySelector("video");
        if (video) {
          // Decode the first frame without starting audible playback under the hold.
          video.preload = "auto"; video.src = video.dataset.mediaSource;
          const loaded = await new Promise(resolve => {
            let drop = () => {};
            const finish = ok => {
              video.removeEventListener("loadeddata", onReady); video.removeEventListener("error", onError);
              drop(); resolve(ok && isCurrent(state, token));
            };
            const onReady = () => finish(true), onError = () => finish(false);
            video.addEventListener("loadeddata", onReady, { once: true });
            video.addEventListener("error", onError, { once: true });
            drop = listen(state, token, () => finish(false));
            if (video.readyState >= 2) finish(true);
          });
          if (!loaded) { fail(command, state, token, "Presentation video could not be decoded"); return; }
        }
      }
      if (!isCurrent(state, token)) return;
      state.prepared = true;
      emit(command, "ready", state);
    } catch (error) {
      if (isCurrent(state, token)) fail(command, state, token, error?.message || "Presentation preparation failed");
    }
  };

  const getSceneIds = snapshot => snapshot.presentationCommand
    ? ["nli.presentation." + snapshot.presentationCommand.presentationSessionId] : [];
  const prepareScene = async (snapshot, { signal, previousSnapshot } = {}) => {
    if (signal?.aborted) throw new Error("Presentation scene cancelled");
    const command = snapshot.presentationCommand;
    if (!command) return null;
    const state = [staged, active, outgoing].find(value => value?.sessionId === command.presentationSessionId && value.generation === command.presentationGeneration);
    if (!state || (!state.prepared && !state.opened)) throw new Error("Presentation candidate is not prepared");
    return { state, signal, installed: active === state || outgoing === state,
      exitBeforeEntry: state.segment.kind === "blackout" && !state.opened && previousSnapshot?.enabledIds?.includes("nli.people") === true };
  };
  const applyScene = (prepared, { snapshot, runtime, signal, semanticOnly = false } = {}) => {
    if (disposed || signal?.aborted || semanticOnly || !prepared) return;
    const state = prepared.state;
    if (prepared.signal?.aborted || state !== active && state !== staged && state !== outgoing) return;
    if (outgoing === state) restoreOutgoing();
    if (staged === state) {
      clearOutgoing();
      outgoing = active;
      if (outgoing) {
        clearTimeout(outgoing.deadlineTimer); cancelPending(outgoing);
        for (const video of outgoing.overlay.querySelectorAll("video")) stopStateVideo(outgoing, video);
        outgoing.overlay.classList.replace("nli-reveal-overlay", "nli-reveal-outgoing");
      }
      active = state; staged = null;
    }
    state.overlay.style.transition = "none";
    runtime.registerElement(getSceneIds(snapshot)[0], state.overlay, {
      // The outgoing map is already at zero for a blackout entry. Cover the
      // basemap immediately so its overview labels cannot show through the wall.
      adoptVisible: state.opened === true || prepared.exitBeforeEntry === true,
      onTeardown: () => {
        const close = state.closeCommand;
        removeState(state);
        if (outgoing === state) outgoing = null;
        if (close) emitOnce(close, "closed", state);
      },
    });
    runtime.markMemberReady(getSceneIds(snapshot)[0]);
  };
  const settleScene = async snapshot => {
    const state = active;
    if (!state || state.opened || state.closing || state.sessionId !== snapshot.presentationCommand?.presentationSessionId) return;
    const video = state.sections.get(state.slide)?.querySelector("video");
    if (video && !await startVideo(state, state.token, video)) {
      fail(state.command, state, state.token, "Presentation video playback is unavailable"); return;
    }
    if (!isCurrent(state, state.token)) return;
    clearTimeout(state.deadlineTimer); completeOpen(state);
    emitOnce(state.command, "opened", state);
  };
  const closeManaged = command => {
    const match = state => state && command.segmentId === state.segment.id &&
      command.presentationSessionId === state.sessionId && command.presentationGeneration === state.generation;
    if (!isValidatedClose(command)) { emitOnce(command, "ignored", active); return; }
    if (match(staged)) {
      const state = staged;
      if (command.sequence <= state.lastSequence) { emitOnce(command, "ignored", state); return; }
      removeState(state); sceneCommand = active?.command || null; emitOnce(command, "closed", state); return;
    }
    if (!match(active)) {
      highestGeneration = Math.max(highestGeneration, command.presentationGeneration);
      emitOnce(command, "closed", null); return;
    }
    if (!active.opened) {
      const state = active;
      if (command.sequence <= state.lastSequence) { emitOnce(command, "ignored", state); return; }
      removeState(state); restoreOutgoing();
      emitOnce(command, "closed", state); return;
    }
    if (command.sequence <= active.lastSequence) { emitOnce(command, "ignored", active); return; }
    active.lastSequence = command.sequence; active.closeCommand = command; active.closing = true;
    cancelPending(active); sceneCommand = null;
    for (const video of active.overlay.querySelectorAll("video")) stopStateVideo(active, video);
  };

  const hide = async (state, token) => {
    for (const video of state.overlay.querySelectorAll("video")) stopStateVideo(state, video);
    await fadeOverlay(state, token, 0);
    if ((active === state || staged === state) && state.token === token && !disposed) {
      removeState(state, { mediaStopped: true });
      clearOutgoing();
    }
  };

  const beginClose = (state) => {
    if (state.closePromise) return state.closePromise;
    state.closing = true;
    const token = beginOperation(state);
    state.closePromise = hide(state, token);
    return state.closePromise;
  };

  const closeCommand = async (command) => {
    if (!isValidatedClose(command)) {
      emitOnce(command, "ignored", active);
      return;
    }
    const state = active;
    const matches = Boolean(state &&
      command.segmentId === state.segment.id &&
      command.presentationSessionId === state.sessionId &&
      command.presentationGeneration === state.generation);
    if (!matches) {
      if (!state && command.presentationGeneration >= highestGeneration) clearOutgoing();
      highestGeneration = Math.max(highestGeneration, command.presentationGeneration);
      emitOnce(command, "closed", null);
      return;
    }
    if (command.sequence <= state.lastSequence) {
      emitOnce(command, "ignored", state);
      return;
    }
    state.lastSequence = command.sequence;
    await beginClose(state);
    emitOnce(command, "closed", state);
  };

  const ownsManagedCandidate = command => command?.presentationAction === "close" &&
    [staged, active].some(state => state?.managedScene && !state.opened &&
      command.segmentId === state.segment.id && command.presentationSessionId === state.sessionId &&
      command.presentationGeneration === state.generation);
  const getPendingSceneCommand = () => {
    if (sceneCommand?.presentationAction !== "open") return null;
    const state = [staged, active].find(candidate => candidate?.managedScene && !candidate.opened && !candidate.closing &&
      candidate.segment.id === sceneCommand.segmentId && candidate.sessionId === sceneCommand.presentationSessionId &&
      candidate.generation === sceneCommand.presentationGeneration);
    return state?.command || null;
  };
  const handleCommand = async (command, { managedScene = false, signal } = {}) => {
    if (disposed || !command || typeof command !== "object") return;
    if (command.presentationAction === "open") {
      if (managedScene) await openManaged(command, { signal });
      else await open(command);
      return;
    }
    if (command.presentationAction === "close") {
      if (managedScene || ownsManagedCandidate(command)) closeManaged(command);
      else await closeCommand(command);
      return;
    }
    if (!active || active.closing ||
        command.segmentId !== active.segment.id ||
        command.presentationSessionId !== active.sessionId ||
        command.presentationGeneration !== active.generation ||
        !Number.isInteger(command.sequence) || command.sequence <= active.lastSequence) {
      emitOnce(command, "ignored", active);
      return;
    }
    active.lastSequence = command.sequence;
    const state = active;
    if (command.presentationAction !== "next" && command.presentationAction !== "previous") {
      emitOnce(command, "ignored", state);
      return;
    }
    const direction = command.presentationAction === "next" ? 1 : -1;
    const target = Math.max(state.segment.range[0], Math.min(
      state.segment.range[1], state.slide + direction,
    ));
    if (target === state.slide) {
      emitOnce(command, "ready", state);
      return;
    }
    const token = beginOperation(state);
    boundOperation(command, state, token, "Presentation slide change timed out");
    stopStateVideo(state, state.sections.get(state.slide)?.querySelector("video"));
    state.slide = target;
    state.reveal.slide(target - state.segment.range[0]);
    await activateSlide(command, state, token, target, "ready");
  };

  return {
    handleCommand, getSceneIds, prepareScene, applyScene, settleScene,
    getSceneCommand: () => sceneCommand, getPendingSceneCommand,
    closeForScene() {
      if (staged) removeState(staged);
      sceneCommand = null;
      if (active) {
        active.closing = true; cancelPending(active);
        for (const video of active.overlay.querySelectorAll("video")) stopStateVideo(active, video);
      }
    },
    discardScene(prepared) {
      if (prepared && !prepared.installed && (staged === prepared.state || active === prepared.state)) {
        const candidate = staged === prepared.state;
        removeState(prepared.state);
        if (!candidate) restoreOutgoing();
        sceneCommand = active?.command || null;
      }
    },
    close() {
      if (disposed) return Promise.resolve();
      const state = active;
      if (!state) {
        clearOutgoing();
        return Promise.resolve();
      }
      return beginClose(state);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (staged) removeState(staged);
      clearOutgoing();
      const state = active;
      if (state) {
        state.token = ++operationToken;
        cancelPending(state);
        removeState(state);
      }
    },
  };
}
