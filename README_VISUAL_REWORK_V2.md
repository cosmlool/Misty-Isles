# Misty Isles — visual rework v2

This patch expands the illustration integration in the actual client UI. It does not replace the game with a static screenshot and does not change server gameplay logic.

## What changed
- Added a second, consolidated visual stylesheet to `client/index.html` for page panels, city hub, shop, inventory item frames, map nodes, timers, reminders, logs, and buttons.
- Applied the existing local illustrations to actual interface sections: coastal-city, city-panel, archipelago-map, forest-region, character-mage, and shop-texture.
- Improved contrast, borders, hover/disabled states, and mobile breakpoints while keeping controls as HTML buttons.
- Kept item ID-based SVG paths and the existing `onerror` category fallback.

## Install
Back up your current project and `server/data`. Copy `client/index.html` from this archive, and copy `client/public/assets/illustrations/` if you want to merge rather than replace the whole client. Keep your current `client/src/main.ts` and server files unchanged for this visual-only patch. Then run `npm ci` and `npm run build` in `client`.

## Verification note
The ZIP structure and local asset paths were checked. `npm ci` timed out in the build environment, so a complete TypeScript/Vite build could not be confirmed here. Run `npm run build` locally before replacing your live client.
