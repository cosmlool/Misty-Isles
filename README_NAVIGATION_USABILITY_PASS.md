# Navigation usability pass — 24 October 2026

This is a code-only UX pass based on Stage 15. No game art or server gameplay logic was changed.

## Changes

- The left sidebar now exposes the eight common destinations first: Character, Inventory, World Map, City, Hunt, Quests, Shop, and Event Log.
- Less frequently used destinations are organized under **All other sections**, grouped by their existing navigation categories.
- Added an in-menu search field. It filters navigation labels and IDs, opens the secondary section while searching, and shows a clear no-results message.
- Navigation buttons use the existing `data-tab` click delegation, preserving the current SPA route behavior.
- Fixed the quick-access options: Inventory is now a valid shortcut, and duplicate Journal entries were removed.
- Added keyboard-friendly focus styling and small-screen layout rules for the search field and grouped destinations.

## Checks performed in this environment

- Project verification script: passed; 6 manifest groups, 192 unique paths, 0 errors and 0 warnings.
- Asset audit: passed; 192 manifest entries checked and files present.
- TypeScript transpile/syntax check: 0 syntax diagnostics.
- Full `npm run build` was attempted but could not complete because dependencies were only partially installed in this environment (`colyseus.js` / `vite` missing; an `@types/estree` type-definition error occurred). An `npm ci` attempt timed out. Therefore this archive is **not claimed to have passed a full production build** here.

## Apply

Unzip this archive and use its `game` folder as the project version, or copy `client/src/main.ts` and `client/index.html` into the matching files in the existing project. Keep your existing server data backups before replacing a project folder.
