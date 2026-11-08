# Stage 18 — Structural Layout Rebuild (v4)

- Replaced contradictory layout behavior with one final authoritative CSS layer.
- Desktop uses a single three-column grid: left navigation, main content, right timers/reminders.
- Timers and reminders are grid content, not fixed overlays.
- Medium widths move the right widgets below the main page while preserving the left navigation.
- Narrow widths stack navigation, main page and widgets.
- Added min-width safeguards to nested cards and character equipment grids.
- No server/gameplay logic was changed.

Validation performed: ZIP integrity, source presence, and static CSS/layout checks. Browser visual QA was not run in this environment.
