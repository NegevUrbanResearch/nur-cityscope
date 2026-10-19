import { isGisBasemapId, isSatelliteBasemap, normalizeGisBasemap } from "../shared/gis-basemap.js";
import { t } from "./remote-locale.js";

const BASEMAPS = {
  osm: { key: "basemapOsm", image: new URL("../../images/basemaps/streets.png", import.meta.url).href },
  satellite: { key: "basemapSatelliteColor", image: new URL("../../images/basemaps/aerial.png", import.meta.url).href },
  satellite_bw: { key: "basemapSatelliteBw", image: new URL("../../images/basemaps/aerial.png", import.meta.url).href },
  dark: { key: "basemapDark", image: new URL("../../images/basemaps/dark.jpg", import.meta.url).href },
};

export function deriveBasemapControlState(basemap, narrativeActive = false, connected = true) {
  const normalized = normalizeGisBasemap(basemap);
  return { parentActive: isSatelliteBasemap(normalized), colorPressed: normalized === "satellite", bwPressed: normalized === "satellite_bw", disabled: !!narrativeActive || !connected };
}

export function createRemoteBasemapController(options = {}) {
  const root = options.root;
  if (!root) return null;
  const documentTarget = options.document ?? globalThis.document;
  const toggle = root.querySelector("#basemapGalleryToggle");
  const gallery = root.querySelector("#basemapGallery");
  let basemap = normalizeGisBasemap(options.initialBasemap);
  let confirmedBasemap = basemap;
  let menuOpen = false, pending = false, disposed = false;
  const render = (next = basemap, { confirmed = true } = {}) => {
    if (disposed) return;
    basemap = normalizeGisBasemap(next);
    if (confirmed) confirmedBasemap = basemap;
    const disabled = deriveBasemapControlState(basemap, options.isNarrativeActive?.(), options.isConnected?.() !== false).disabled || pending;
    if (disabled) menuOpen = false;
    root.querySelectorAll(".basemap-button[data-basemap]").forEach(button => {
      const selected = button.getAttribute("data-basemap") === basemap;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = disabled;
      button.setAttribute("aria-disabled", String(disabled));
      button.style.opacity = disabled ? "0.5" : "1";
      button.style.pointerEvents = disabled ? "none" : "auto";
    });
    if (toggle) { toggle.disabled = disabled; toggle.setAttribute("aria-expanded", String(menuOpen)); }
    if (gallery) gallery.hidden = !menuOpen;
    const definition = BASEMAPS[basemap];
    const label = root.querySelector("#basemapCurrentLabel");
    if (label) { label.setAttribute("data-i18n", definition.key); label.textContent = t(definition.key); }
    const image = root.querySelector("#basemapCurrentImage");
    if (image) { image.src = definition.image; image.classList.toggle("is-monochrome", basemap === "satellite_bw"); }
  };
  const closeMenu = (restoreFocus = false) => {
    if (!menuOpen) return;
    menuOpen = false; render(basemap, { confirmed: false });
    if (restoreFocus) toggle?.focus();
  };
  const handleClick = event => {
    if (options.isConnected?.() === false || options.isNarrativeActive?.() === true || pending) return;
    if (toggle && (event.target === toggle || toggle.contains?.(event.target))) {
      menuOpen = !menuOpen; render(basemap, { confirmed: false });
      return;
    }
    const button = event.target?.closest?.("[data-basemap]");
    if (!button || !root.contains(button) || button.disabled) return;
    const requested = button.getAttribute("data-basemap");
    if (!isGisBasemapId(requested)) return;
    pending = true; menuOpen = false;
    options.onBasemapSelected?.(requested);
    render(requested, { confirmed: false });
    Promise.resolve().then(() => options.setBasemap?.(requested)).then(result => {
      if (result?.ok === false) throw result.error ?? "Basemap command failed";
      confirmedBasemap = requested;
    }).catch(error => options.onError?.(error)).finally(() => {
      pending = false;
      render(options.getBasemap?.() ?? confirmedBasemap);
    });
  };
  const handleOutside = event => { if (!root.contains(event.target)) closeMenu(); };
  const handleKey = event => { if (event.key === "Escape") closeMenu(true); };
  root.addEventListener("click", handleClick);
  documentTarget?.addEventListener("click", handleOutside);
  documentTarget?.addEventListener("focusin", handleOutside);
  documentTarget?.addEventListener("keydown", handleKey);
  render();
  return { render, destroy() {
    disposed = true;
    root.removeEventListener("click", handleClick);
    documentTarget?.removeEventListener("click", handleOutside);
    documentTarget?.removeEventListener("focusin", handleOutside);
    documentTarget?.removeEventListener("keydown", handleKey);
  } };
}
