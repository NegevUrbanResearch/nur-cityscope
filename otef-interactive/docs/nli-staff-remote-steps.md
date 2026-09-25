# NLI Staff Remote: What Each Step Changes

This describes what the staff remote (`nli-staff-remote.html`) does to the GIS
screen and the projection model at every step, as currently implemented in
`frontend/src/remote/nli-staff-script.js`. The intended sequence is in
[nli-remote-run-of-show.md](nli-remote-run-of-show.md).

## How a step is applied

Opening a step sends its **cue** to the map. A cue has four optional parts,
applied in this order:

1. **Narrative.** The step's narrative is the cue's `narrative` if it has one,
   otherwise the script's narrative (`null` for the main show and Shura). The
   remote only switches narrative when it differs from the current one. If it
   is already current, the remote just clears any selected person.
2. **Clock stop.** If the cue sets a clock, the running timeline is stopped
   first.
3. **Layers.** The cue's layer list becomes the exact set of enabled layers.
   Every other layer is turned off.
4. **Escape routes** (Nova only). Listed routes turn on and unlisted routes
   turn off.
5. **Clock play.** A `{ from, to }` window starts the timeline: `from` is the
   start minute (earlier events appear already revealed), and `to` drops
   events after that minute. `"idle"` leaves the clock stopped, which shows
   the complete story for the enabled layers.

A cue part that is left out keeps its current state. For example, a step
without a clock does not stop or restart a timeline that is already playing.

If you move to a new step while a cue is still being applied, the old cue is
abandoned and only the latest one completes. The status line under the step
shows *applying*, *ready*, or *failed*.

Leaving a step that uses the presentation closes the presentation. Returning
home cancels any pending cue, closes the archive and presentation, and exits
the narrative.

## What entering a narrative does

These effects come from the server whenever the narrative changes:

| Effect | Entering a narrative | Exiting to the overview (`null`) |
| :--- | :--- | :--- |
| Basemap | Black-and-white satellite | Dark |
| Clock | Reset to idle | Unchanged |
| Selected person | Cleared | Unchanged |
| Escape routes | All off | All off |

On the GIS screen, entering a narrative flies the camera to the narrative's
center and zoom. If the narrative has a focus settlement, the other
settlements dim and it gets the focus outline. If it has a label, a red point
marker is placed with that label. Both screens also apply the narrative's
people filter.

Nova is the GIS camera exception: entry fits the reviewed Nova extent with 48
px padding. The extent stays fixed while the five timeline beats change. The
Mor route may move the GIS camera; turning the route off restores the Nova
extent.

| Narrative | Camera | Focus settlement | Marker label | People shown | Idle clock caption |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `segev` | Segev home, zoom 18 | בארי | בית משפחת שגב (at the camera center) | Everyone except survivors | 06:41 |
| `nova` | Reviewed Nova extent, 48 px padding | נובה (and polygon 100 highlighted) | נובה | Everyone with location Nova | 08:03 |
| `sderot` | Sderot, zoom 15 | שדרות | תחנת המשטרה (police station) | Everyone except survivors | 06:29 |
| `hostages` | Nir Oz, zoom 15 | ניר עוז | בית משפחת פרי (Peri home) | Everyone with location Nir Oz | 06:29 |
| `hostages_all` | Regional overview `[34.5, 31.4]`, zoom 10 | None (no dimming) | None | Kidnap survivors and murdered in captivity, from all locations | 06:29 |
| Overview (`null`) | Configured map bounds, zoom 10 | None | None | Everyone except survivors | 06:29 |

The legend matches the people filter.

## Layer sets

| Set | Layers |
| :--- | :--- |
| Focus | Settlement names, settlement outlines, settlements, Route 232, black ground |
| Opening | Focus + SEA + Gaza roads |
| Timeline | Opening + investigation polygons, infiltration routes, alarms |
| Nova timeline | Focus + investigation polygons, infiltration routes, alarms (no SEA, no Gaza roads) |
| Identity | Focus + people |
| Wall | People names only (while names are on, both screens draw no other layer) |

Open spaces is `land_use.שטחים_פתוחים`, the layer labelled "Open space" in
the visitor remote.

## Main show

The main show has no narrative, so any step with a cue exits the current
narrative.

| # | Step | Layers | Clock | Other | Remote controls |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | Opening | Opening | Stopped (idle) | | |
| 2 | The opening minutes | Timeline | Plays from the first event up to 06:41 | | Timeline; Next becomes **Start the story: Segev family** |
| 3 | The rest of the day | Timeline | Plays from 06:42 to the end (earlier events already shown) | | Timeline; Next becomes **Start the story: Nova and Mor Levy** |
| 4 | Identity database | Identity | Stopped (idle) | | Name search |
| 5 | Wall of names | Wall | Stopped (idle) | | Name search |
| 6 | Back to the start | Opening | Stopped (idle) | | |

The narratives are not separate slides. On the slide before a narrative, the
Next button is replaced by a button that starts it, so the show cannot skip
it. The last slide of a narrative shows **Finish story, continue sequence**, which
continues with the following show slide. The last Nova slide instead replaces
Next with three side-by-side choices: Sderot, Shura Camp, and Hostages. After
the chosen narrative, the show continues with the identity database.
**Previous** on a narrative's first slide returns to the show slide before it.
A narrative opened from the home screen ends with **Finish**.

## Segev family (`segev`)

| # | Step | Layers | Clock | Remote controls |
| :---: | :--- | :--- | :--- | :--- |
| 1 | The house in Be'eri | Focus | Idle after entry (caption 06:41) | |
| 2 | Presentation | Focus | No change | Presentation (Canva, slides 1–8) |

## Nova and Mor Levy (`nova`)

| # | Step | Layers | Clock | Escape routes | Remote controls |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | The Nova site | Focus + open spaces | Stopped; previews beat 1 and shows 08:03 | All off | |
| 2 | The Nova story | Nova timeline | Five authored beats, 4 seconds each (20 seconds total); play starts beat 1 at 0% | All off | Five-mark scrubber and beat navigation |
| 3 | Escape routes | Nova timeline | No change | Individual routes on | Escape toggles |
| 4 | Mor Levy | Nova timeline | No change | Mor's route only | Escape toggles, archive (מור לוי), presentation* |
| 5 | Memorial | Focus + people (Nova people only) | No change | Individual routes on | Escape toggles, presentation* |

The Nova timeline uses five authored beats, not source-timestamp grouping:

| Beat | Event time | Presenter title |
| :---: | :--- | :--- |
| 1 | 08:12–08:23 | Highway 232 and the Nova site |
| 2 | 08:26–08:40 | The fighting expands |
| 3 | 09:00–09:15 | Abductions and parking areas |
| 4 | 10:30 | Noa Argamani and Avinatan Or |
| 5 | 12:00–13:00 | Abductions during the afternoon |

The remote shows only the active beat's event time, title, and presenter
paragraph. The exhibit clock reads 08:03 before playback and after Stop; Play
begins beat 1 at zero reveal. Each automatic beat lasts four seconds. Natural
completion holds beat 5 and 100% progress. Back, forward, pointer selection,
and Left/Right, Home, and End keyboard controls select a beat without wrapping;
the first and last marks sit at the scrubber ends. Polygon 107 is excluded
pending source review and its source record is unchanged.

## Sderot (`sderot`)

| # | Step | Layers | Clock | Remote controls |
| :---: | :--- | :--- | :--- | :--- |
| 1 | Sderot | Focus | Idle after entry | |
| 2 | Presentation | Focus | No change | Presentation* (slides 17–20) |

## Shura Camp (no narrative, draft)

Both steps are drafts. Opening Shura exits any narrative (dark basemap,
overview camera).

| # | Step | Layers | Clock | Remote controls |
| :---: | :--- | :--- | :--- | :--- |
| 1 | Shura Camp | Focus | No change | |
| 2 | Presentation | Focus | No change | Presentation* (slides 21–27) |

## Hostages (`hostages`)

| # | Step | Narrative | Layers | Clock | Remote controls |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | Nir Oz | `hostages` | Focus | Idle after entry | Archive (חיים פרי) |
| 2 | Presentation | `hostages` | Focus | No change | Presentation* (slides 28–33) |
| 3 | Nir Oz victims and hostages | `hostages` | Focus + people (Nir Oz people) | No change | |
| 4 | All hostages | `hostages_all` | Focus + people (all hostages) | Idle after entry | |

Step 4 switches to `hostages_all`: the camera pulls back, Nir Oz dimming and
the Peri marker go away, and only hostages are shown. Going back to step 3
re-enters `hostages` and flies back to Nir Oz.

\* The presentation button appears only when the narrative has a
presentation link. Only Segev has one, so the other presentation steps show
no presentation button yet.

## Archive

- **Archive button** (Nova step 4, Hostages step 1): selects the named person
  and opens their NLI record in the archive window on the GIS machine. Pressing
  it again closes the archive.
- **Name search** (identity database and wall of names): picking a person
  selects them. The GIS map flies to the point and shows a name pop-up, and
  the model marks the point.
- **GIS pop-up:** clicking a person's name pop-up on the GIS screen opens their
  record in the same archive window. The remote is not told, so its archive
  button does not switch to "back to map".
- Selecting a different person closes an open archive record.

## Free screen scenes

Scenes turn on from the free screen. Each scene exits any active narrative
to the overview. Pressing the active scene again turns all layers off and
stops the clock.

| Scene | Layers | Clock |
| :--- | :--- | :--- |
| Opening | Opening | Stopped (idle) |
| Loop timeline | Timeline | Plays the whole day on repeat |
| Identity database | Identity | Stopped (idle) |
| Names wall | Wall | Stopped (idle) |
| Layers | Opens the manual layer picker | No change |
