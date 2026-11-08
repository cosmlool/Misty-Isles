# Misty Isles — Stage 8: Visual Asset QA

This stage adds a browser-based gallery to inspect the actual local asset paths and strengthens the manifest audit. It does not claim to perform automated visual regression of all gameplay screens.

## Run the checks

```powershell
cd C:\game\client
npm ci
npm run audit:assets
npm run build
npm run dev
```

Then open `http://localhost:5173/asset-gallery.html` (use the actual Vite port if different). The gallery shows every manifest entry. Any image that fails to load is marked with a red border and counted at the top.

## What is checked
- 149 item IDs, 16 location images, 16 character/creature images, and 10 illustration assets listed in the manifest.
- Manifest paths exist, are non-empty, and pass basic SVG/raster-file sanity checks.
- A browser gallery verifies that images can load from the running Vite server.

## Important limitation
The gallery verifies file loading, not that every item image is already wired into every production game screen. The full game still needs manual browser checks for character, map, city, shop, inventory, hunting, mail, quests, auction, guilds and PvP. The server and save data are unchanged by this stage.
