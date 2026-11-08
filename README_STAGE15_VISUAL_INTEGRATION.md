# Stage 15 — visual integration and repeatable verification

## Changes
- Added one final layout style pass after legacy CSS so the map, character portraits and item art keep their aspect ratios and don't inherit decorative page-wide copies of the archipelago image.
- Removed the repeated map texture from the page background and top bar, keeping the main map illustration inside the atlas viewport.
- Kept city-card backgrounds clear rather than applying one generic forge image across different city services.
- Added `client/scripts/verify-project.mjs` and `npm run verify:project` for repeatable manifest/reference checks followed by asset audit and production build.

## Run checks on Windows
```bat
cd /d C:\game\client
npm ci
npm run verify:project
```

Then, in a second terminal:
```bat
cd /d C:\game\server
npm ci
npm run build
npm run dev
```

## Verification record for this archive
- `npx tsc --noEmit`: passed in the available Linux workspace.
- `npm run audit:assets`: passed; 192 manifest entries exist and pass basic format checks.
- `vite build`: could not complete in the available Linux workspace because Rollup's optional platform package `@rollup/rollup-linux-x64-gnu` was absent from that workspace. This is an environment/dependency-install issue; it does not override the successful Vite build the user reported on their Windows machine.
- Browser rendering and interactive clicks were not automated here. Check character, map, city, hunting, shop and inventory in the browser before treating this as release-ready.

## Remaining art work
This stage is layout/integration cleanup, not a claim that all low-resolution character images have been replaced with new high-detail illustrations. Those must be replaced with independent source artwork per character/creature/item, not enlarged with CSS or substituted by one full-screen composite.
