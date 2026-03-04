test("src AdvancedStyleEngine keeps visible marker fill when trailing fill layer is transparent", async () => {
  const mod = await import("../../frontend/src/map-utils/advanced-style-engine.js");
  const AdvancedStyleEngine =
    mod.default && typeof mod.default === "function"
      ? mod.default
      : mod.default?.default || mod;

  const symbol = {
    symbolLayers: [
      {
        type: "markerPoint",
        marker: {
          shape: "circle",
          size: 20,
          fillColor: "#a8a800",
        },
      },
      {
        type: "fill",
        fillType: "solid",
        color: "#a8a800",
        opacity: 1,
      },
      {
        type: "stroke",
        color: "#ffffff",
        width: 2.5,
        opacity: 0.25,
      },
      {
        type: "fill",
        fillType: "solid",
        color: "#377eb8",
        opacity: 0,
      },
    ],
  };

  const out = AdvancedStyleEngine.symbolIRToLeafletProps(symbol);

  expect(out.fillColor).toBe("#a8a800");
  expect(out.fillOpacity).toBe(1);
  expect(out.radius).toBe(10);
});
