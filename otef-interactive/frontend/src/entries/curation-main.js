function ensureItmProjection() {
  if (typeof proj4 === "undefined" || typeof proj4.defs !== "function") {
    return;
  }

  const existing = proj4.defs("EPSG:2039");
  if (existing) return;

  proj4.defs(
    "EPSG:2039",
    "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs",
  );
}

async function boot() {
  ensureItmProjection();
  await import("../map-utils/coordinate-utils.js");
  await import("../curation/curation.js");
}

boot().catch((error) => {
  console.error("[frontend-b] curation bootstrap failed", error);
});
