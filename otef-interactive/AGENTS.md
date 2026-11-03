# OTEF Interactive agent guidance

## Scope and source of truth

- Preserve the existing GIS, projection, projection-config, three-tab remote
  (Navigation, Layers, Presentation), and NLI staff remote applications.
  Do not replace them or add another frontend shell without owner approval.
- For NLI behavior, the source of truth is the contracts in this file, the
  current code, and `docs/nli-exhibit-verification.md` (acceptance status).
  `docs/nli-staff-remote-steps.md` describes what each staff-remote step does.
- Do not read or write `docs/superpowers/` or `.superpowers/`. Plans, specs,
  and task reports stay local and gitignored. Never point docs, code, or tests
  at those paths.

## Data boundaries

- NLI source and processed artifacts are intentionally gitignored and can move
  between project workstations. Preserve them unless a task explicitly changes
  the accepted release.
- Identify the accepted NLI source by SHA-256, not by a mutable ZIP filename.
- Do not remove stable `pid` values or expose NLI URLs in the remote people
  index. The remote uses `hasArchiveRecord`; the GIS resolves `nli_url` locally
  from validated `people.geojson`.
- Runtime NLI files are served below
  `/otef-interactive/public/processed/layers/nli/`. Test production URLs through
  nginx, not only through Vite or direct filesystem access.
- The exhibit computer requires a one-time, machine-wide Chrome popup allowlist
  for exactly `http://localhost:80`. From the repository root, run the following
  command in Windows PowerShell as administrator:

  ```powershell
  & '.\otef-interactive\scripts\configure-chrome-popup-policy.ps1' -Mode Install
  ```

  Running the script without `-Mode Install` only reports policy status. The
  same Install also adds `--disable-features=CrossOriginOpenerPolicy` to Google
  Chrome shortcuts so archive close can work, and writes Desktop `OTEF GIS.lnk`
  with a dedicated `--user-data-dir=%LOCALAPPDATA%\OTEF\gis-chrome-profile` and
  `--remote-debugging-address=127.0.0.1`. Open GIS from that OTEF GIS shortcut
  so the localhost pager can address that GIS profile on port 9222. Never enable
  debugging on the signed-in Chrome profile. The presenter interacts only with
  the remote.
- `start-otef.ps1` / `start-otef.sh` start `nli-archive-pager.mjs` and warn if
  7733 is down. The presenter still only uses the remote.
- Phone remotes and QR need `otef-interactive/frontend/runtime/share.json`.
  `start-otef.ps1` / `start-otef.sh` write it once per run from this machine's
  current physical Ethernet/Wi-Fi LAN IPv4 and optional `tailscale ip -4`.
  Ignore legacy saved hotspot configuration. `setup.ps1` / `setup.sh` call that helper at
  the end of first-time setup. `docker compose up` alone does not. If Tailscale
  is missing, hide Tailnet and keep Local remotes enabled. Do not bring back a
  LAN-IP watcher or `network.json` freshness window.

## Interaction and rendering contracts

- GIS and projection share timeline semantics. Keep display differences in
  named theme/profile tokens.
- **Pause** freezes narrative reveal but completed-line flow continues.
  GIS **Stop** rewinds the armed window to its scene play start and stays paused.
  GIS **idle** (full-timeline cues, Home, archive, scene changes, slideshow)
  shows the complete investigation story. Nova **Stop** keeps its 08:03 idle
  preview. Idle alarms stay off.
- People points show on both GIS and projection with the same status colors.
  Select people from the remote **Navigation** tab or the staff remote search
  steps. The GIS also shows the selected person's bubble with only name and
  location; clicking it opens that person's archive record through the same
  archive bridge the remote uses. Archive open/close is driven from the remote.
- Archive open/close is an ephemeral command. Do not add migrations, leases,
  owners, heartbeats, polling, iframe embedding, or durable archive state
  without a new owner decision.
- NLI blocks embedding. Use the named top-level `otef-nli-archive` window and
  treat placement, focus, and cross-origin load as manual kiosk acceptance.
- Clear archive presentation when person selection changes. Filter delayed
  commands by PID and dataset version.

## Implementation workflow

- Preserve unrelated dirty-tree changes and ignored artifacts.
- Do not commit, push, create a branch, or create a worktree unless the user
  explicitly authorizes it for the current task.
- Add focused tests before behavior changes. Run the relevant frontend tests,
  Django tests, `npm run build:frontend`, and `git diff --check`.
- For user-interface changes, verify the rendered GIS, projection, or remote
  surface. Automated DOM tests do not replace exhibit-browser checks.
- Keep modules focused and report line growth. Do not compress unrelated logic
  into large files to satisfy a nominal line budget.

## Current acceptance status

Core NLI behavior is implemented. The remaining gate is documented in
`docs/nli-exhibit-verification.md`: confirm the named NLI window and return flow
in the normal exhibit browser, then complete hardware visual and performance
tuning.
