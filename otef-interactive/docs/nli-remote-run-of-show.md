# NLI Remote Run of Show

This document is an English translation of the NLI-authored Hebrew run of show
received on 2026-09-22. It records the intended exhibit sequence and notes
where current NLI remote behavior already supports parts of it. The tables
describe the intended sequence, including steps still to be implemented.

Blank cells, question marks, and incomplete steps are preserved from the source.
The [NLI exhibit verification guide](nli-exhibit-verification.md) remains the
source of truth for current acceptance status.

Current code defines Segev, Nova, Sderot, and Hostages narrative entry scenes.
Selecting any of them centers and zooms the GIS map, selects the black-and-white
satellite basemap, and applies the narrative focus. Segev has a separately
controlled presentation; Nova has an 08:03 clock and escape-route controls.
These existing scene elements are starting points for the longer sequences below.

[Presentation](https://nli-my.sharepoint.com/:p:/g/personal/uri_ayalon_nli_org_il/IQD47nUGojhWS7-q5GSJVUNBAXiA-LABDwC7s_zZgZ_A1ns?rtime=AdOhnb8Y30g)

## Projection sequence and screen content

| GIS screen | Projection / model | Stage | Order |
| :--- | :--- | :--- | :---: |
| Settlement names and outlines, Route 232, SEA, and Gaza roads | Settlement names and outlines, Route 232, SEA, and Gaza roads | Opening | 1 |
| Settlements and their names dim. Polygons, infiltration routes, and NLI alarms appear as time advances. Settlements are revealed and turn red when active infiltration routes or polygons intersect them. The clock appears below Gaza. Ashkelon, Netivot, and Ofakim are visible. | Settlements and their names dim. Polygons, infiltration routes, and NLI alarms appear as time advances. Settlements are revealed and turn red when active infiltration routes or polygons intersect them. The clock appears below Gaza. | Timeline: the first hour (06:29–06:41, when the Segev family events begin) | 2 |
| See the [Segev family table](#segev-family). |  | [Segev family](#segev-family) | 3 |
| Settlements and their names dim. Polygons, infiltration routes, and NLI alarms appear as time advances. Settlements are revealed and turn red when active infiltration routes or polygons intersect them. The clock appears below Gaza. Ashkelon, Netivot, and Ofakim are visible. | Settlements and their names dim. Polygons, infiltration routes, and NLI alarms appear as time advances. Settlements are revealed and turn red when active infiltration routes or polygons intersect them. The clock appears below Gaza. | Timeline: the rest of the day (06:42–end of day); zoom out from the Segev family and return to the full Negev view | 4 |
| See the [Nova table](#nova-and-mor-levy). |  | [Nova and Mor Levy](#nova-and-mor-levy) | 5 |
| See each narrative table. The narrative names are links. |  | Narratives (free choice): [Sderot](#sderot), [Shura Camp](#shura-camp), and [Hostages (Haim Peri of Nir Oz)](#hostages-haim-peri) | 6 |
| Settlement names and outlines, Route 232, and people shown as points. After a name search, zoom in on the point and show a pop-up with the name above it. Do not show Gaza roads. A remote action opens that person's archive record. | Settlement names and outlines, Route 232, and people shown as points. After a name search, zoom in on the point and mark it with a square of light. Dim the other points or make the selected point more prominent. Do not show Gaza roads. | Identity database | 7 |
| All names appear on the model as a wall. All other layers are dimmed; no layer other than the names is visible. The operator can search for a specific name or place. Associated names light up while the others dim, and the selected place lights up. | All names appear on the model as a wall. All other layers are dimmed; no layer other than the names is visible. The operator can search for a specific name or place. Associated names light up while the others dim, and the selected place lights up. | Wall of names | 8 |
|  |  | Return to the opening | 9 |

## Narratives and screen content

### Segev family

| Notes | GIS screen | Projection / model | Order |
| :--- | :--- | :--- | :---: |
|  | Zoom in on the Segev family home in black-and-white aerial imagery. Show the clock at 06:41. Mark the house with a pink/red square and the label “Segev family home.” | Focus on Be'eri. Dim the other settlements. Only Be'eri remains prominent, with a square of light and a halo around it. | 1 |
|  | Replace the map with the presentation and advance through slides 1–8. | Same | 2 |
|  |  |  | 3 |
|  |  |  | 4 |
|  |  |  | 5 |
|  |  |  | 6 |
|  |  |  | 7 |

[Return to the sequence](#projection-sequence-and-screen-content)

### Nova and Mor Levy

| Notes | GIS screen | Projection / model | Order |
| :--- | :--- | :--- | :---: |
|  | Zoom in on the Nova site in black-and-white aerial imagery. Show the clock at 08:03. | Dim the model and focus on the Nova site at 08:03. Dim the other settlements. Only Nova remains prominent, with a square of light and a halo around it. Show the open-spaces layer in the background. | 1 |
|  | Zoom in on the Nova site and show its division into areas, with names. | Remove the open-spaces layer. Show the Nova polygons over time, in chronological order. Advance the clock with them. Use no more than five timeline events. | 2 |
| The first part describes what happened collectively. Now move to Mor Levy's individual story. |  | Show the escape routes taken by people from Nova. Settlements light up when the escape routes intersect them. | 3 |
| Begin Mor's story. The guide describes her background and the route she took. | Replace the map with the presentation and show slides 9–11. | Show Mor's route on the model: Nova, one of the lemon groves, and then the Midburn staging site. | 4 |
|  | Show slides 12–16: images from the Nova site archive with memorial points. | Dim the model except for the settlements and settlement names intersected by Nova escape routes. Show points for people murdered at Nova only, as well as people kidnapped and murdered or kidnapped and returned alive. | 5 |
|  |  |  | 6 |
|  |  |  | 7 |

[Return to the sequence](#projection-sequence-and-screen-content)

### Sderot

| Notes | GIS screen | Projection / model | Order |
| :--- | :--- | :--- | :---: |
|  | Zoom in on Sderot in black-and-white aerial imagery. Place a point on the Sderot police station. | Dim the model and focus on Sderot. Dim the other settlements. Only Sderot remains prominent, with a square of light and a halo around it. | 1 |
|  | Replace the map with the presentation and show slides 17–20. | Same | 2 |
|  |  |  | 3 |
|  |  |  | 4 |
|  |  |  | 5 |
|  |  |  | 6 |
|  |  |  | 7 |

[Return to the sequence](#projection-sequence-and-screen-content)

### Hostages (Haim Peri)

| Notes | GIS screen | Projection / model | Order |
| :--- | :--- | :--- | :---: |
|  | Zoom in on Nir Oz in black-and-white aerial imagery. Place a point on the Peri family home and show the label “Peri family home.” | Dim the model and focus on Nir Oz. Dim the other settlements. Only Nir Oz remains prominent, with a square of light and a halo around it. | 1 |
|  | Replace the map with the presentation and show slides 28–33. | Same | 2 |
|  | Determine which presentation content belongs here. | Same, with points for people murdered in Nir Oz only, as well as people kidnapped and murdered or kidnapped and returned alive. | 3 |
|  | Determine which presentation content belongs here. | Stop dimming the model and remove the focus from Nir Oz. Show points only for all hostages, including people kidnapped and murdered and people kidnapped and returned alive. | 4 |
|  |  |  | 5 |
|  |  |  | 6 |
|  |  |  | 7 |

[Return to the sequence](#projection-sequence-and-screen-content)

### Shura Camp

| Notes | GIS screen | Projection / model | Order |
| :--- | :--- | :--- | :---: |
|  | ? | ? | 1 |
|  | Replace the map with the presentation and show slides 21–27. | ? | 2 |
|  |  |  | 3 |
|  |  |  | 4 |
|  |  |  | 5 |
|  |  |  | 6 |
|  |  |  | 7 |

[Return to the sequence](#projection-sequence-and-screen-content)

## Translation and implementation notes

- `SEA` and `Gaza roads` are layer names. The source's “range sites” in the Nova
  sequence is understood to refer to the Nova polygons; confirm the exact
  polygon selection when implementing that step.
- “Beats” means timeline events. The NLI sequence calls for no more than five
  Nova events in that step; the current Nova timeline has 12 beats and needs
  consolidation to meet that request.
