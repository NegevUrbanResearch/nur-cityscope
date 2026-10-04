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
});

const IMAGE_READY_MS = 1500;
const FADE_MS = 600;
const VIDEO_START_MS = 1500;
const OPEN_DEADLINE_MS = 4500;

function mediaUrl(path) {
  return `/otef-interactive/public/${path}`;
}

function slideImagePath(manifest, slide) {
  const path = manifest.deck.slidePaths?.[slide - 1] ??
    manifest.deck.slidePathPattern.replace("{slide}", String(slide).padStart(2, "0"));
  return manifest.deck.pdfSha256 ? `${path}?v=${encodeURIComponent(manifest.deck.pdfSha256)}` : path;
}

function stopVideo(video) {
  if (!video) return;
  try { video.pause(); } catch (_) { /* The media element may not have started. */ }
  try { video.currentTime = 0; } catch (_) { /* Ignore media elements without a timeline. */ }
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

export function shouldCloseViewerForNarrative({ handledExitRevision = 0, state, segment } = {}) {
  const next = nextHandledExitRevision(handledExitRevision, state);
  if (next.fresh) return { ...next, close: true };
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

  const isCurrent = (state, token) => Boolean(state) && active === state && state.token === token && !disposed;

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
    if (active === state) active = null;
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

  const fail = (command, state, token, message) => {
    if (!state || state.token !== token || active !== state || disposed || emitted.has(command)) return;
    clearTimeout(state.deadlineTimer);
    removeState(state);
    emitOnce(command, "unavailable", state, message);
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

  const waitForImage = (state, token, slide) => {
    const image = state.sections.get(slide)?.querySelector("img");
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
      const timer = setTimeout(() => finish(false), VIDEO_START_MS);
      let drop = () => {};
      drop = listen(state, token, () => finish(false, { release: false }));
      settled.then((ok) => {
        if (isCurrentVideo() && ok && !video.paused && !video.ended) setPlaybackActive(state, true);
        finish(ok);
      });
    });
  };

  const activateSlide = async (command, state, token, slide, outcome) => {
    const loaded = await waitForImage(state, token, slide);
    if (!isCurrent(state, token)) return;
    if (!loaded) {
      fail(command, state, token, "Presentation slide image could not be loaded");
      return;
    }
    const video = state.sections.get(slide)?.querySelector("video");
    if (video) {
      const started = await startVideo(state, token, video);
      if (!isCurrent(state, token)) return;
      if (!started) {
        fail(command, state, token, "Presentation video playback is unavailable");
        return;
      }
    }
    if (!isCurrent(state, token)) return;
    emitOnce(command, outcome, state);
  };

  const buildOverlay = (segment) => {
    const overlay = element("div", "nli-reveal-overlay");
    overlay.style.opacity = "0";
    if (segment.kind === "blackout") {
      overlay.classList.add("nli-reveal-overlay--blackout");
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
      return { overlay, revealRoot: null, sections: new Map(), cancels: [] };
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
        const video = element("video");
        video.src = mediaUrl(videoSpec.path);
        video.controls = false;
        video.playsInline = true;
        video.preload = "auto";
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
    if (active) removeState(active);
    const state = {
      ...buildOverlay(segment),
      segment,
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
    state.deadlineTimer = setTimeout(() => {
      fail(command, state, token, "Presentation open timed out");
    }, OPEN_DEADLINE_MS);
    try {
      if (segment.kind === "blackout") {
        const faded = await fadeOverlay(state, token, 1);
        if (!isCurrent(state, token) || !faded) return;
        clearTimeout(state.deadlineTimer);
        emitOnce(command, "opened", state);
        emit(command, "ready", state);
        return;
      }
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
      emitOnce(command, "opened", state);
    } catch (error) {
      if (!isCurrent(state, token)) return;
      fail(command, state, token, error?.message || "Presentation viewer could not be initialized");
    }
  };

  const hide = async (state, token) => {
    for (const video of state.overlay.querySelectorAll("video")) stopStateVideo(state, video);
    await fadeOverlay(state, token, 0);
    if (active === state && state.token === token && !disposed) removeState(state, { mediaStopped: true });
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

  const handleCommand = async (command) => {
    if (disposed || !command || typeof command !== "object") return;
    if (command.presentationAction === "open") {
      await open(command);
      return;
    }
    if (command.presentationAction === "close") {
      await closeCommand(command);
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
    stopStateVideo(state, state.sections.get(state.slide)?.querySelector("video"));
    state.slide = target;
    state.reveal.slide(target - state.segment.range[0]);
    await activateSlide(command, state, token, target, "ready");
  };

  return {
    handleCommand,
    close() {
      if (disposed) return Promise.resolve();
      const state = active;
      if (!state) return Promise.resolve();
      return beginClose(state);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const state = active;
      if (state) {
        state.token = ++operationToken;
        cancelPending(state);
        removeState(state);
      }
    },
  };
}
