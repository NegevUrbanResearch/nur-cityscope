// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const html = fs.readFileSync(path.resolve("frontend/remote-controller.html"), "utf8");
const document = new DOMParser().parseFromString(html, "text/html");

describe("regular tablet remote markup", () => {
  test("the header exposes both language choices, fullscreen and an accessible connection dot", () => {
    expect(document.getElementById("remoteLocaleEn").textContent.trim()).toBe("EN");
    expect(document.getElementById("remoteLocaleHe").textContent.trim()).toBe("עב");
    expect(document.getElementById("remoteFullscreenBtn")).not.toBeNull();
    expect(document.getElementById("remoteFullscreenStatus")).not.toBeNull();
    expect(document.getElementById("statusText").classList.contains("visually-hidden")).toBe(true);
  });

  test("settlement search keeps its combobox contract without people controls or a fixed list", () => {
    expect(document.getElementById("placeSearchInput").getAttribute("aria-controls")).toBe("placeSuggestions");
    expect(document.getElementById("placeSuggestions").children).toHaveLength(0);
    expect(document.querySelector("[data-search-mode]")).toBeNull();
    expect(document.getElementById("zoomSlider")).toBeNull();
    expect(document.getElementById("zoomIn")).not.toBeNull();
    expect(document.getElementById("zoomOut")).not.toBeNull();
    expect(document.getElementById("zoomValue")).not.toBeNull();
  });

  test("all basemap variants live in one initially closed visual gallery", () => {
    expect(document.getElementById("basemapGalleryToggle").getAttribute("aria-expanded")).toBe("false");
    const gallery = document.getElementById("basemapGallery");
    expect(gallery.hidden).toBe(true);
    expect([...gallery.querySelectorAll("button[data-basemap]")].map((button) => button.dataset.basemap)).toEqual(["osm", "satellite", "satellite_bw", "dark"]);
    expect(gallery.querySelectorAll("img")).toHaveLength(4);
    expect(document.getElementById("basemapCurrentLabel")).not.toBeNull();
  });
});
