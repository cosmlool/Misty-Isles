# Misty Isles — Stage 7: Asset Integration & Audit

This stage adds a machine-readable asset manifest and a repeatable local audit. It does not alter gameplay rules, server handlers, or player save data.

## Included
- `client/public/assets/asset-manifest.json`: item IDs and paths, location images, character art, and illustration assets.
- `client/scripts/audit-assets.mjs`: checks that every file listed in the manifest exists.
- `npm run audit:assets`: runs the asset audit from the `client` folder.

## Verify on Windows
```powershell
cd C:\game\client
npm ci
npm run audit:assets
npm run build
```

The audit verifies manifest paths, not visual quality or browser rendering. After running the game, check the character, map, city, shop, hunting, inventory, and item hover tooltips.
