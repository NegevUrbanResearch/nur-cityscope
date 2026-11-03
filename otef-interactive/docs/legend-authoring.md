# Legend authoring

The GIS and projection legends are generated from the layer registry and the
effective authored style. Do not add rows in legend rendering code. Colors,
line widths, dashes, markers, and hatches remain in the layer's existing
`style`; legend metadata supplies meaning and policy only.

## Metadata

- `legend.label.{he,en}` gives a bilingual pack, layer, or category label.
- `legend.hidden: true` explicitly hides a helper layer or category.
- `legend.familyId` merges only intentionally related geometry variants within
  the same pack.
- `legend.summary.label.{he,en}` explicitly permits a meaningful summary.
  Layer summaries apply automatically. Group summaries become eligible for the
  remote operator control. NLI is never summarized.
- `ui.hideInLegend` remains supported for an existing helper-layer contract,
  but new definitions should use `legend.hidden`.

Label precedence is inline bilingual metadata, checked-in bilingual copy,
authored name/class label, then stable ID/class value. A plain
`ui.legendLabel` string is not bilingual metadata and cannot replace available
bilingual copy in the other language.

## Two-class example

```js
{
  id: "evacuation_status",
  name: "Evacuation status",
  geometryType: "polygon",
  legend: {
    label: { he: "מצב פינוי", en: "Evacuation status" }
  },
  style: {
    renderer: "uniqueValue",
    uniqueValues: {
      field: "status",
      classes: [
        {
          value: "open",
          legend: { label: { he: "פתוח", en: "Open" } },
          symbol: {
            symbolLayers: [
              { type: "fill", color: "#22c55e", opacity: 0.55 },
              { type: "stroke", color: "#14532d", width: 2 }
            ]
          }
        },
        {
          value: "closed",
          legend: { label: { he: "סגור", en: "Closed" } },
          symbol: {
            symbolLayers: [
              { type: "fill", color: "#ef4444", opacity: 0.55 },
              { type: "stroke", color: "#7f1d1d", width: 2 }
            ]
          }
        }
      ]
    }
  }
}
```

To hide a non-visitor helper, add `legend: { hidden: true }` to that layer or
class. To allow an authored group summary, add a bilingual
`group.legend.summary.label`; the remote Layers sheet will then show the
summary toggle for that non-NLI group.

## Diagnostics

If a visible layer is absent, inspect the browser console for
`[MapLegend] Skipping <full-id>`. The message distinguishes missing authored
raw style from an unsupported renderer. Add support to the shared style-to-
symbol path; do not fabricate a gray fallback, duplicate renderer, or hard-code
the layer in the legend.
