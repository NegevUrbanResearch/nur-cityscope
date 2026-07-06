import { searchPlaces as defaultSearchPlaces } from "../shared/place-navigation/place-catalog.js";
import { LOCALE_EVENT, getLocale, t } from "./remote-locale.js";

function labelForPlace(place) {
  const locale = getLocale();
  return (
    (locale === "en" ? place?.name?.en : place?.name?.he) ||
    place?.name?.he ||
    place?.name?.en ||
    place?.id ||
    ""
  );
}

function setHidden(element, hidden) {
  if (!element) return;
  element.hidden = !!hidden;
  if (hidden) {
    element.setAttribute("hidden", "");
  } else {
    element.removeAttribute("hidden");
  }
}

function syncInputDirection(input) {
  if (!input) return;
  input.dir = input.value.trim() ? "auto" : getLocale() === "he" ? "rtl" : "ltr";
}

export function initRemotePlaceNavigation(options = {}) {
  const root = options.root || document.getElementById("placeSearchGroup");
  if (!root) return null;

  const input = root.querySelector("#placeSearchInput");
  const clear = root.querySelector("#placeSearchClear");
  const list = root.querySelector("#placeSuggestions");
  const status = root.querySelector("#placeSearchStatus");
  const searchPlaces = options.searchPlaces || defaultSearchPlaces;
  const dataContext = options.dataContext;
  const isConnected = options.isConnected || (() => true);
  const canNavigateToPlace =
    typeof options.canNavigateToPlace === "function" ? options.canNavigateToPlace : () => true;

  if (!input || !clear || !list || !status) return null;

  let suggestions = [];
  let activeIndex = -1;

  function setStatus(message = "") {
    status.textContent = message;
  }

  function setRootClass(name, enabled) {
    if (!root.classList || typeof root.classList.toggle !== "function") return;
    root.classList.toggle(name, !!enabled);
  }

  function setActiveIndex(index) {
    if (!suggestions.length) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }

    activeIndex = Math.max(0, Math.min(index, suggestions.length - 1));
    Array.from(list.children).forEach((child, childIndex) => {
      child.setAttribute("aria-selected", childIndex === activeIndex ? "true" : "false");
    });

    const activePlace = suggestions[activeIndex];
    if (activePlace) {
      input.setAttribute("aria-activedescendant", `place-option-${activePlace.id}`);
    }
  }

  function render(nextSuggestions) {
    suggestions = Array.isArray(nextSuggestions) ? nextSuggestions : [];
    activeIndex = -1;
    list.replaceChildren();
    input.setAttribute("aria-expanded", suggestions.length ? "true" : "false");
    setHidden(list, suggestions.length === 0);

    suggestions.forEach((place, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "place-suggestion";
      option.id = `place-option-${place.id}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = labelForPlace(place);
      option.addEventListener("click", () => {
        void selectPlace(place);
      });
      list.append(option);

      if (index === 0) {
        setActiveIndex(0);
      }
    });

    if (!suggestions.length) {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function closeSuggestions() {
    render([]);
  }

  function isEventInsideRoot(event) {
    const eventPath =
      typeof event?.composedPath === "function" ? event.composedPath() : null;
    if (Array.isArray(eventPath) && eventPath.includes(root)) {
      return true;
    }

    const target = event?.target;
    if (!target) {
      return false;
    }

    if (target === root) {
      return true;
    }

    if (typeof root.contains === "function") {
      return root.contains(target);
    }

    return false;
  }

  function refresh(reason) {
    const query = input.value.trim();
    syncInputDirection(input);
    setHidden(clear, query.length === 0);
    list.setAttribute("aria-label", t("placeSuggestionsAria"));
    input.setAttribute("aria-disabled", isConnected() ? "false" : "true");
    setRootClass("is-disconnected", !isConnected());

    if (!isConnected()) {
      render([]);
      setStatus(t("placeSearchDisconnected"));
      return;
    }

    if (!query && reason !== "focus") {
      render([]);
      setStatus("");
      return;
    }

    const results = searchPlaces(query, {
      includeStarter: reason === "focus" && !query,
      limit: 8,
      canNavigateToPlace,
    });
    render(results);
    setStatus(results.length ? "" : t("placeSearchEmpty"));
  }

  async function selectPlace(place) {
    if (canNavigateToPlace(place) === false) {
      render([]);
      setStatus(t("placeSearchEmpty"));
      return;
    }

    const placeLabel = labelForPlace(place);
    input.value = placeLabel;
    syncInputDirection(input);
    setHidden(clear, false);
    render([]);
    setStatus(t("placeSearchTravelling", { place: placeLabel }));
    setRootClass("is-pending", true);

    try {
      const result = await dataContext?.navigateToPlace?.(place);
      if (result?.ok === false) {
        setStatus(t("placeSearchFailed"));
        return;
      }
      setStatus("");
    } catch {
      setStatus(t("placeSearchFailed"));
    } finally {
      setRootClass("is-pending", false);
    }
  }

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "placeSuggestions");
  input.setAttribute("aria-expanded", "false");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("placeSuggestionsAria"));
  syncInputDirection(input);

  input.addEventListener("focus", () => refresh("focus"));
  input.addEventListener("input", () => refresh("input"));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault?.();
      setActiveIndex(activeIndex + 1);
      return;
    }

    if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault?.();
      setActiveIndex(activeIndex - 1);
      return;
    }

    if (event.key === "Enter" && suggestions[activeIndex]) {
      event.preventDefault?.();
      void selectPlace(suggestions[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      closeSuggestions();
      setStatus("");
    }
  });

  clear.addEventListener("click", () => {
    input.value = "";
    syncInputDirection(input);
    setHidden(clear, true);
    closeSuggestions();
    setStatus("");
    input.focus?.();
  });

  const handleDocumentPointerDown = (event) => {
    if (!suggestions.length || isEventInsideRoot(event)) {
      return;
    }

    closeSuggestions();
  };
  document.addEventListener?.("pointerdown", handleDocumentPointerDown);

  const handleLocaleChange = () => {
    list.setAttribute("aria-label", t("placeSuggestionsAria"));
    refresh("locale");
  };
  window.addEventListener?.(LOCALE_EVENT, handleLocaleChange);

  return {
    refresh,
    destroy() {
      document.removeEventListener?.("pointerdown", handleDocumentPointerDown);
      window.removeEventListener?.(LOCALE_EVENT, handleLocaleChange);
    },
  };
}

export default initRemotePlaceNavigation;
