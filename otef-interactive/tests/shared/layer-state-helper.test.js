const {
  resolveLayerState,
  parseFullLayerId,
  getLayerIdOnly,
  getEffectiveLayerGroups,
} = require("../../frontend/src/shared/layer-state-helper");

describe("layer-state-helper: parseFullLayerId", () => {
  test("returns null for invalid or missing dot", () => {
    expect(parseFullLayerId(null)).toBeNull();
    expect(parseFullLayerId(undefined)).toBeNull();
    expect(parseFullLayerId("")).toBeNull();
    expect(parseFullLayerId("noDot")).toBeNull();
    expect(parseFullLayerId("onlyGroup")).toBeNull();
  });

  test("returns { groupId, layerId } for two-part fullLayerId", () => {
    const result = parseFullLayerId("projector_base.model_base");
    expect(result).not.toBeNull();
    expect(result).toEqual({
      groupId: "projector_base",
      layerId: "model_base",
    });
  });

  test("supports layer ids that contain dots (first-dot split)", () => {
    const result = parseFullLayerId("map_3.layer.with.dots");
    expect(result).not.toBeNull();
    expect(result).toEqual({ groupId: "map_3", layerId: "layer.with.dots" });
  });

  test("returns null when groupId or layerId segment is empty", () => {
    expect(parseFullLayerId(".onlyLayer")).toBeNull();
    expect(parseFullLayerId("onlyGroup.")).toBeNull();
    expect(parseFullLayerId(".")).toBeNull();
  });
});

describe("layer-state-helper: getLayerIdOnly", () => {
  test("returns null when parseFullLayerId returns null", () => {
    expect(getLayerIdOnly(null)).toBeNull();
    expect(getLayerIdOnly("")).toBeNull();
    expect(getLayerIdOnly("noDot")).toBeNull();
  });

  test("returns layerId (everything after first dot)", () => {
    expect(getLayerIdOnly("projector_base.model_base")).toBe("model_base");
    expect(getLayerIdOnly("map_3.layer.with.dots")).toBe("layer.with.dots");
  });
});

describe("layer-state-helper: resolveLayerState", () => {
  function makeCtx(groups) {
    return {
      getLayerGroups: () => groups,
    };
  }

  test("returns null when ctx or fullLayerId are invalid", () => {
    const ctx = makeCtx([]);
    expect(resolveLayerState(null, "a.b")).toBeNull();
    expect(resolveLayerState(ctx, "")).toBeNull();
    expect(resolveLayerState(ctx, "onlyGroup")).toBeNull(); // missing dot
  });

  test("returns null when no matching group or layer is found", () => {
    const ctx = makeCtx([
      { id: "group1", layers: [{ id: "layer1", enabled: true }] },
    ]);

    expect(resolveLayerState(ctx, "missing.layer1")).toBeNull();
    expect(resolveLayerState(ctx, "group1.missing")).toBeNull();
  });

  test("returns group, layer and enabled flag when found", () => {
    const groups = [
      {
        id: "group1",
        layers: [
          { id: "layer1", enabled: false },
          { id: "layer2", enabled: true },
        ],
      },
    ];
    const ctx = makeCtx(groups);

    const state1 = resolveLayerState(ctx, "group1.layer1");
    expect(state1).not.toBeNull();
    expect(state1.group).toBe(groups[0]);
    expect(state1.layer).toBe(groups[0].layers[0]);
    expect(state1.enabled).toBe(false);

    const state2 = resolveLayerState(ctx, "group1.layer2");
    expect(state2).not.toBeNull();
    expect(state2.enabled).toBe(true);
  });
});

describe("layer-state-helper: curated group display names", () => {
  afterEach(() => {
    // Clean up globals so other tests are not affected.
    delete global.OTEFDataContext;
    delete global.layerRegistry;
  });

  test("uses backend-sent group name when present for curated groups", () => {
    global.OTEFDataContext = {
      getLayerGroups: () => [
        {
          id: "curated_my_project",
          name: "My Project",
          enabled: true,
          layers: [{ id: "1", displayName: "Layer 1", enabled: true }],
        },
      ],
    };
    // No registry groups; only context should be used.
    delete global.layerRegistry;

    const groups = getEffectiveLayerGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("curated_my_project");
    expect(groups[0].name).toBe("My Project");
  });

  test("derives human-readable name from curated_<slug> when name is missing", () => {
    global.OTEFDataContext = {
      getLayerGroups: () => [
        {
          id: "curated_my_other_project",
          enabled: true,
          layers: [{ id: "1", displayName: "Layer 1", enabled: true }],
        },
      ],
    };
    delete global.layerRegistry;

    const groups = getEffectiveLayerGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("curated_my_other_project");
    expect(groups[0].name).toBe("my other project");
  });
});

