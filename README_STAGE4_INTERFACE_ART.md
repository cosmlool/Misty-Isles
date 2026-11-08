# Stage 4 — Unified illustrated interface

This update layers a cohesive dark teal / warm gold fantasy visual system onto the existing client UI. It modifies the global stylesheet in `client/index.html`; gameplay handlers and server data are untouched.

## Visual changes
- Global atmospheric archipelago background with low opacity.
- Unified teal-and-gold frames for top bar, navigation, cards, resources, tabs, and inputs.
- More legible title hierarchy and stronger interactive button states.
- Refined illustrated banners and region showcases, including responsive behavior.
- Responsive navigation and spacing for smaller screens.

## Install/test
1. Back up the working project and `server/data`.
2. Unzip to a separate test folder first.
3. In `client`, run `npm ci`, then `npm run build`.
4. Run the client and check character, map, city, shop, inventory, quests, journal, auction, clan/guild, and PvP pages. Verify all actions still respond.

## Validation note
The ZIP archive integrity is checked. Dependency installation timed out in the preparation environment, so a full Vite/TypeScript build could not be confirmed here. No server code or saved player data was modified.
