import { createRemotePeopleArchiveController } from "../../frontend/src/remote/remote-people-archive-controller.js";
import { LOCALE_EVENT, getLocale, t } from "../../frontend/src/remote/remote-locale.js";

// Input plumbing for the shared NLI controller's integration/race fixtures.
// Regular navigation deliberately no longer creates this people interface.
export function initPeopleSearchFixture(options = {}) {
  const root = options.root || document.getElementById("placeSearchGroup");
  const input = root.querySelector("#placeSearchInput");
  const clear = root.querySelector("#placeSearchClear");
  const list = root.querySelector("#placeSuggestions");
  const status = root.querySelector("#placeSearchStatus");
  const buttons = root.querySelectorAll?.("[data-search-mode]") || [];
  const connected = options.isConnected || (() => true);
  const narrative = typeof options.narrativeActive === "function" ? options.narrativeActive : () => options.narrativeActive === true;
  const runtime = options.peopleRuntime;
  let mode = "settlements", request = 0, active = -1, suggestions = [], cancel = 0;
  const hidden = (element, value) => {
    if (!element) return;
    element.hidden = value;
    if (value) element.setAttribute("hidden", "");
    else element.removeAttribute("hidden");
  };
  const setStatus = (value = "") => { status.textContent = value; };
  const setClass = (name, value) => root.classList?.toggle?.(name, value);
  const syncDirection = () => { input.dir = input.value.trim() ? "auto" : getLocale() === "he" ? "rtl" : "ltr"; };
  function setActive(index) {
    active = suggestions.length ? Math.max(0, Math.min(index, suggestions.length - 1)) : -1;
    [...list.children].forEach((item, i) => item.setAttribute("aria-selected", String(i === active)));
    if (active >= 0) input.setAttribute("aria-activedescendant", `person-option-${suggestions[active].pid}`);
    else input.removeAttribute("aria-activedescendant");
  }
  function render(items = []) {
    suggestions = items;
    list.replaceChildren();
    hidden(list, !items.length);
    input.setAttribute("aria-expanded", String(!!items.length));
    items.forEach((person) => {
      const button = document.createElement("button");
      button.className = "place-suggestion person-suggestion";
      button.id = `person-option-${person.pid}`;
      button.textContent = person.name;
      button.setAttribute("role", "option");
      button.addEventListener("click", () => { void controller.selectPerson(person); });
      list.append(button);
    });
    setActive(0);
  }
  function syncUi() {
    buttons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.searchMode === mode));
      button.disabled = button.dataset.searchMode === "people" && narrative();
    });
    input.disabled = mode === "people" && narrative();
    input.setAttribute("aria-disabled", String(input.disabled || !connected()));
    for (const [attribute, key] of [["placeholder", mode === "people" ? "peopleSearchPlaceholder" : "placeSearchPlaceholder"], ["aria", mode === "people" ? "peopleSearchAria" : "placeSearchAria"]]) {
      input.setAttribute(`data-i18n-${attribute}`, key);
      if (attribute === "placeholder") input.placeholder = t(key);
      else input.setAttribute("aria-label", t(key));
    }
  }
  function refresh() {
    const generation = ++request;
    syncDirection();
    hidden(clear, !input.value);
    if (mode !== "people" || narrative() || !connected() || !input.value.trim()) {
      render([]);
      if (narrative()) setStatus(t("peopleNarrativeDisabled"));
      return;
    }
    void runtime.load().then(() => {
      if (request === generation && mode === "people" && !narrative()) render(runtime.search(input.value.trim(), getLocale(), 8));
    });
  }
  const controller = createRemotePeopleArchiveController({
    ...options, root, input, clear, list, status, navigationSection: root.closest?.("#navigationSection") || root,
    getMode: () => mode, setMode: (next) => { mode = next; },
    renderSuggestions: render, setStatus, setRootClass: setClass, setHidden: hidden,
    syncInputDirection: syncDirection, onModeUiChange: syncUi, onRefresh: refresh, isNarrativeActive: narrative,
  });
  buttons.forEach((button) => button.addEventListener("click", () => { void controller.switchMode(button.dataset.searchMode); }));
  input.addEventListener("input", refresh);
  input.addEventListener("focus", () => { if (controller.shouldSuppressFocus()) render([]); else refresh(); });
  input.addEventListener("keydown", (event) => {
    const moves = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: suggestions.length - 1 };
    if (Object.hasOwn(moves, event.key) && suggestions.length) { event.preventDefault?.(); setActive(moves[event.key]); }
    if (event.key === "Enter" && suggestions[active]) { event.preventDefault?.(); void controller.selectPerson(suggestions[active]); }
    if (event.key === "Escape") render([]);
  });
  clear.addEventListener("click", async () => {
    const generation = ++cancel, previous = input.value;
    input.value = "";
    render([]);
    hidden(clear, true);
    setStatus("");
    try {
      const result = await options.dataContext?.cancelNavigationFocus?.();
      if (result?.ok === false) throw new Error("cancel failed");
    } catch {
      if (generation !== cancel || input.value) return;
      if (!controller.restoreAcknowledgedQuery()) input.value = previous;
      setStatus(t("placeSearchFailed"));
    }
  });
  const locale = () => { syncUi(); controller.handleLocaleChange(); refresh(); };
  window.addEventListener?.(LOCALE_EVENT, locale);
  syncUi();
  return { destroy() { request += 1; cancel += 1; controller.destroy(); window.removeEventListener?.(LOCALE_EVENT, locale); } };
}
