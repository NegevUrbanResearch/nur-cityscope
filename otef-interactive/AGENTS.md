# OTEF Interactive agent guidance

## Scope and source of truth

- Preserve the existing GIS, projection, and three-tab remote applications.
  Do not replace them or add another frontend shell without owner approval.
- For NLI behavior, read the reconciled status at the top of:
  - `../docs/superpowers/specs/2026-08-30-nli-investigation-interactions-design.md`
  - `../docs/superpowers/plans/2026-08-30-nli-investigation-interactions-implementation.md`
- Treat `../.superpowers/sdd/` reports as implementation evidence. Historical
  lease, persistent archive-state, ownership, polling, and recovery sections
  in the original plan are superseded.

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

  Running the script without `-Mode Install` only reports policy status. This
  setup is a technician action; the presenter interacts only with the remote.

## Interaction and rendering contracts

- GIS and projection share timeline semantics. Keep display differences in
  named theme/profile tokens.
- **Pause** freezes narrative reveal but completed-line flow continues.
  **Stop** resets timeline-authored polygons, settlement outlines, and alarms;
  visible routes return to the animated final-state idle flow.
- People selection belongs in the existing remote **Navigation** tab. The GIS
  bubble contains only name and location; archive actions belong on the remote.
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
