import Reveal from "../../vendor/reveal.js/reveal.esm.js";

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

function mediaUrl(path) {
  return `/otef-interactive/public/${path}`;
}

function slideImagePath(manifest, slide) {
  return manifest.deck.slidePathPattern.replace("{slide}", String(slide).padStart(2, "0"));
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

export function createNliRevealPresentation(container, {
  manifest,
  RevealClass = Reveal,
  emitResult = () => {},
} = {}) {
  let highestGeneration = 0;
  let active = null;
  let imageWaitCleanup = null;
  let disposed = false;

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

  const cancelImageWait = () => {
    imageWaitCleanup?.();
    imageWaitCleanup = null;
  };

  const teardown = () => {
    cancelImageWait();
    if (!active) return;
    for (const video of active.overlay.querySelectorAll("video")) stopVideo(video);
    try { active.reveal?.destroy?.(); } catch (_) { /* Keep GIS usable if Reveal teardown fails. */ }
    active.overlay.remove();
    active = null;
  };

  const fail = (command, message) => {
    const state = active;
    teardown();
    emit(command, "unavailable", state, message);
  };

  const isCurrent = (state, slide) => active === state && state.slide === slide && !disposed;

  const waitForImage = (state, slide) => new Promise((resolve) => {
    const image = state.sections.get(slide)?.querySelector("img");
    if (!image) {
      resolve(false);
      return;
    }
    if (image.complete) {
      resolve(image.naturalWidth > 0);
      return;
    }

    const finish = (loaded) => {
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      if (imageWaitCleanup === cleanup) imageWaitCleanup = null;
      resolve(loaded && isCurrent(state, slide));
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    const cleanup = () => {
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      resolve(false);
    };
    imageWaitCleanup = cleanup;
    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
  });

  const activateSlide = async (command, state, slide, outcome) => {
    cancelImageWait();
    const loaded = await waitForImage(state, slide);
    if (!isCurrent(state, slide)) return;
    if (!loaded) {
      fail(command, "Presentation slide image could not be loaded");
      return;
    }
    const video = state.sections.get(slide)?.querySelector("video");
    if (video) {
      try {
        video.muted = false;
        await video.play();
      } catch (error) {
        if (!isCurrent(state, slide)) return;
        fail(command, error?.message || "Presentation video playback is unavailable");
        return;
      }
    }
    if (!isCurrent(state, slide)) return;
    emit(command, outcome, state);
  };

  const buildOverlay = (segment) => {
    const overlay = element("div", "nli-reveal-overlay");
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
        const video = element("video");
        video.src = mediaUrl(videoSpec.path);
        video.controls = false;
        video.playsInline = true;
        video.preload = "auto";
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
    return { overlay, revealRoot, sections };
  };

  const open = async (command) => {
    const generation = command.presentationGeneration;
    if (!Number.isInteger(generation) || generation <= highestGeneration) {
      emit(command, "ignored", active);
      return;
    }
    highestGeneration = generation;
    const segment = manifest?.segments?.find((candidate) => candidate.id === command.segmentId);
    if (!segment) {
      emit(command, "unavailable", null, "Unknown presentation segment");
      return;
    }
    teardown();
    const built = buildOverlay(segment);
    const state = {
      ...built,
      segment,
      reveal: null,
      slide: segment.range[0],
      sessionId: command.presentationSessionId,
      generation,
      lastSequence: command.sequence,
    };
    active = state;
    try {
      state.reveal = new RevealClass(state.revealRoot, { ...REVEAL_OPTIONS });
      await state.reveal.initialize();
    } catch (error) {
      if (active !== state) return;
      fail(command, error?.message || "Presentation viewer could not be initialized");
      return;
    }
    if (active !== state) return;
    await activateSlide(command, state, state.slide, "opened");
  };

  const handleCommand = async (command) => {
    if (disposed || !command || typeof command !== "object") return;
    if (command.presentationAction === "open") {
      await open(command);
      return;
    }
    if (!active ||
        command.segmentId !== active.segment.id ||
        command.presentationSessionId !== active.sessionId ||
        command.presentationGeneration !== active.generation ||
        !Number.isInteger(command.sequence) || command.sequence <= active.lastSequence) {
      emit(command, "ignored", active);
      return;
    }
    active.lastSequence = command.sequence;
    if (command.presentationAction === "close") {
      const state = active;
      teardown();
      emit(command, "closed", state);
      return;
    }
    if (command.presentationAction !== "next" && command.presentationAction !== "previous") {
      emit(command, "ignored", active);
      return;
    }
    const state = active;
    const direction = command.presentationAction === "next" ? 1 : -1;
    const target = Math.max(state.segment.range[0], Math.min(
      state.segment.range[1], state.slide + direction,
    ));
    if (target === state.slide) {
      emit(command, "ready", state);
      return;
    }
    stopVideo(state.sections.get(state.slide)?.querySelector("video"));
    state.slide = target;
    state.reveal.slide(target - state.segment.range[0]);
    await activateSlide(command, state, target, "ready");
  };

  return {
    handleCommand,
    close() {
      teardown();
    },
    dispose() {
      disposed = true;
      teardown();
    },
  };
}
