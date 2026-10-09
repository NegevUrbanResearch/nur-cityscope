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
shows *sending*, *sent*, or *failed*. A failed send stays on the current step.
Press the same control again to retry. A failed presentation close also stays
on the current step and does not take the special Close destination.

Presentation steps show GIS slide controls in the staff remote. Use Previous
and Next for slides and the separate Close button to leave the presentation.
Scene Back, Scene Next, and Home close the presentation before changing the
run-of-show step. Close always stays on the current step and offers Open for
that segment again; no presentation Close changes the step. Wall of names
and Credits are fixed scenes with no slide controls on the remote.
The names wall is projection-only. GIS shows the identity or Credits slide
and does not load or render the names-wall layer.
On entry, their GIS image finishes fading in before the underlying layers
change. If opening fails, the previous map scene stays in place for Retry.
Credits opens slide 37 automatically while retaining the Wall of names layers.
Next and Back switch directly between these scenes without closing the GIS
slide or resetting the scene. The projection keeps the names visible.
Finish or Home restores the Home layers beneath the GIS slide, then fades
the slide out. Hostages covers slides 32–36.

The runtime presentation has 37 slides and retains all 34 original slides in
their original order. Gelem's first 9 seconds is the last Segev slide (9),
Nova's first 12 seconds is the first Memorial slide (13), and Re'im's first
10 seconds is the last Shura slide (31). The previous Memorial opener follows
Nova as slide 14. These videos use the shared NLI background and autoplay
unmuted on entry, stay on the slide when they finish, and rewind on exit.
Each added clip has a one-second fade from black using its frozen first frame,
followed by all selected footage (total durations: Gelem 10s, Nova 13s, Re'im 11s).
Nova removes only the encoded side borders and displays its full image height.
Re'im has no audio track. Gelem's selected excerpt and Nova's recording contain
silence; their original audio is retained as requested.
Returning Home cancels any pending cue, closes a known presentation only after
that close is acknowledged, clears search focus, and applies the Home cue:
the six Home layers, overview narrative, idle clock, and no escape routes.
Black ground, narrative houses, people, the name wall, and investigation rows
turn off. If that reset fails, the remote stays on the previous screen and
shows *failed*; press Home again to retry. The projection camera does not move.
The first connected, hydrated Home applies this reset once. A later reconnect
does not send it again.

## Home shortcuts

The Home screen links directly to the existing Identity Database and Names Wall
steps. These links use the same cues and search controls as the run of show.

Clearing the search field, returning Home, or moving between these two steps
clears both person and place focus. The field is never empty while a search
focus remains active. Search status text appears only for pending work or errors.

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
| Focus | Settlement names, settlement outlines, settlements, Route 232, narrative house outlines |
| Opening | Focus + SEA + Gaza roads |
| Timeline | Opening + investigation polygons, infiltration routes, alarms |
| Nova timeline | Focus + investigation polygons, infiltration routes, alarms (no SEA, no Gaza roads) |
| Identity | Focus + people |
| Wall | People names only (while names are on, both screens draw no other layer) |

Open spaces is `land_use.שטחים_פתוחים`, the layer labelled "Open space" in
the visitor remote.

## Main show

The full projection sequence has eight steps and no separate opening slide.
Home is that opening state. The show has no narrative, so any step with a cue
exits the current narrative.

| # | Step | Layers | Clock | Other | Remote controls |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | The opening minutes | Timeline | Plays from the first event up to 06:41 | | Timeline; Next becomes **Start the story: Segev family** |
| 2 | Segev family | Unchanged until the story starts | Unchanged | Junction, not a slide | One choice: Segev |
| 3 | The rest of the day | Timeline | Plays from 06:42 to the end (earlier events already shown) | | Timeline; Next becomes **Start the story: Nova and Mor Levy** |
| 4 | Nova and Mor Levy | Unchanged until the story starts | Unchanged | Junction, not a slide | One choice: Nova |
| 5 | Narratives | Unchanged until a story starts | Unchanged | Junction, not a slide | Sderot, Shura Camp, Hostages |
| 6 | Identity database | Identity | Stopped (idle) | | Name search |
| 7 | Wall of names | Wall | Stopped (idle) | A black GIS slide titled מאגר הזהויות opens automatically | Name or place search; no slide controls |
| 8 | Credits (קרדיטים) | Wall | Stopped (idle) | Keep the Wall of names layers and automatically open slide 37 on GIS only | No slide controls; Back returns to Wall of names; Finish returns Home |

The narratives are not separate slides. On the slide before a narrative, the
Next button is replaced by a button that starts it, so the show cannot skip
it. The last slide of a narrative shows **Finish story, continue sequence**, which
continues with the following show slide. The last Nova slide instead replaces
Next with three side-by-side choices: Sderot, Shura Camp, and Hostages. After
the chosen narrative, the show continues with the identity database.
**Previous** on a narrative's first slide returns to the show slide before it.
A narrative opened from the home screen ends with **Finish**.

## The timeline

The home screen opens a direct three-step timeline. It is not part of the
eight-step sequence. The first two steps are the same opening-minutes and
rest-of-day cues. The third step, **The full timeline**, shows the complete
idle story immediately: timeline layers, overview narrative, idle clock, and
no escape routes. It does not keep playing and it does not use the Nova ended
clock. Next finishes to Home. Back starts the rest of the day again from 06:42.

Stop on timeline steps 1 and 2 rewinds within the current step to 06:29 and
06:42 respectively, including after scrubbing or stepping. Play resumes there;
Stop does not enter step 3.

| # | Step | Layers | Clock | Remote controls |
| :---: | :--- | :--- | :--- | :--- |
| 1 | The opening minutes | Timeline | Plays up to 06:41 | Timeline |
| 2 | The rest of the day | Timeline | Plays from 06:42 to the end | Timeline |
| 3 | The full timeline | Timeline | Stopped (idle), complete story | Next returns Home |

## Segev family (`segev`)

Segev is one step. The house and the manual presentation controls are on that
same step. Close stays on the step.

| # | Step | Layers | Clock | Remote controls |
| :---: | :--- | :--- | :--- | :--- |
| 1 | The house in Be'eri | Focus | Idle after entry (caption 06:41) | Open the Segev slides from the remote; Close stays on this step. |

## Nova and Mor Levy (`nova`)

| # | Step | Layers | Clock | Escape routes | Remote controls |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | The Nova site | Focus + open spaces | Stopped; previews beat 1 and shows 08:03 | All off | |
| 2 | The compounds | Nova timeline | Five authored beats, 8 seconds each (40 seconds total); play starts beat 1 at 0% | All off | Five-mark scrubber and beat navigation |
| 3 | Escape routes | Nova timeline | Ended; leaves a partial play unfinished | Individual routes on | Individual route control only |
| 4 | Mor Levy | Nova timeline | Ended | Mor's route only | Mor route control; slides open automatically after the cue is ready. Close stays on this step. |
| 5 | Memorial | Focus + people (Nova people only) | Ended Nova clock; compounds stay visible through Nova virtual membership even when the stored rows have no playable layers | Settled intersections; route animation stopped on entry | Memorial slides open automatically after the cue is sent; Close stays on this step. The fleeing-routes button starts animation only when pressed; Stop restores settled intersections. |

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
begins beat 1 at zero reveal. Each automatic beat lasts eight seconds. Natural
completion holds beat 5 and 100% progress. Back, forward, pointer selection,
and Left/Right, Home, and End keyboard controls select a beat without wrapping;
the first and last marks sit at the scrubber ends. Polygon 107 is excluded
pending source review and its source record is unchanged.

The compounds step starts playback. Next leaves that playback before it
finishes and ends the Nova clock on the escape-routes step. Routes expose only
the individual-route control. Mor exposes only Mor's route; its slides open
automatically after the cue is ready. Closing the slides stays on this step.
Memorial keeps route animation stopped on entry. Its fleeing-routes control starts replay on demand and Stop restores settled intersections.

## Sderot (`sderot`)

Sderot is one step. The station and the manual presentation controls are on
that same step. Close stays on the step.

| # | Step | Layers | Clock | Remote controls |
| :---: | :--- | :--- | :--- | :--- |
| 1 | Sderot | Focus | Idle after entry | Open the Sderot slides from the remote; Close stays on this step. |

## Shura Camp (`shura`; no separate entry scene)

| # | Step | Layers | Clock | Remote controls |
| :---: | :--- | :--- | :--- | :--- |
| 1 | Shura Camp | Timeline layers | Idle | Slides 24–31 open automatically after the cue succeeds. Close stays on this step and offers Open again. |

## Hostages (`hostages`)

| # | Step | Narrative | Layers | Clock | Remote controls |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | Nir Oz | `hostages` | Focus | Idle after entry | |
| 2 | Presentation | `hostages` | Focus | No change | Hostages slides open automatically after the cue is ready. Close stays on this step and offers Open again; Scene Next continues to Nir Oz victims and hostages. |
| 3 | Nir Oz victims and hostages | `hostages` | Focus + people (Nir Oz people) | No change | |
| 4 | All hostages | `hostages_all` | Focus + people (all hostages) | Idle after entry | |

Step 4 switches to `hostages_all`: the camera pulls back, Nir Oz dimming and
the Peri marker go away, and only hostages are shown. Going back to step 3
re-enters `hostages` and flies back to Nir Oz.

The presentation steps retain their place in the run of show. Slides stay on
GIS; the projection continues to show the narrative scene.

## Archive

- **Name search** (identity database): picking a person selects them. The GIS
  map flies to the point and shows a name pop-up. Both GIS and projection dim
  the other people points. On the wall of names, a name or place search keeps
  the associated names bright and dims the rest.
- **GIS pop-up:** clicking a person's name pop-up on the GIS screen opens their
  record in the same archive window. The remote is not told, so its archive
  button does not switch to "back to map".
- Selecting a different person closes an open archive record.
- **Staff remote paging:** after a person with an archive record is selected,
  the staff remote shows presentation-scale **Open**, then **Scroll up** /
  **Scroll down** and **Back to map**. Look at the wall (the GIS archive
  window), not the phone. Tap pages one screen. Hold repeats every 500ms.
  Search kit (Identity database) is the live path. Keep `#stepTitle`,
  `#stepNote`, and the scene dock visible. Do not use a workshop Navigation
  replica of nli.org.il. If the live NLI column does not move, stop — do not
  add banner clicking.

## Tablet remote refresh

Use Projection Config on the exhibit PC to check the NLI staff tablet's
connection, loaded frontend version, and last contact. Status reports arrive
when the tablet connects and every 10 seconds; they report status only. They
do not detect releases or reload the tablet. Use the existing trusted exhibit
LAN or Tailnet connection; these controls do not provide authentication for
public access.

Before refreshing, put GIS and projection on Home from the PC and wait for the
Home cue to finish. In Projection Config, refresh the tablet's row once. Each
row targets one tablet session. The tablet's current local screen can be an
older step; its successful reload startup returns it to Home. The first
physical tablet refresh is required after activation to load this feature.

“Reload accepted” is an acknowledgment that the tablet accepted the request;
it does not confirm completion. Wait for “Tablet reloaded to Home,” which is
shown only after the new page completes Home startup. The loaded version may
be unchanged and still be valid. A DOM fullscreen session may end on reload;
tap the tablet's fullscreen control locally if needed.
