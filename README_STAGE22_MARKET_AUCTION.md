# Misty Isles — Stage 22: Market & Auction

## Changes
- Added a server message that exposes up to 200 latest completed auction sales for market analytics. Personal auction history remains private to the player and unchanged.
- Market analytics now uses completed global sales, not only the current player's transactions. Active listings and cancelled listings are excluded.
- Added cancellation of the player's own active auction listing. The server validates ownership and item catalog membership, returns the item to inventory, removes the active lot, and records a cancellation event. The original listing fee is not refunded.
- Inventory listing action now asks for a price and currency instead of silently using fixed example prices.
- Auction cards show a cancellation action only for the current player's own lots.
- Existing listing fee (2%), gold sale commission (5%), auction storage, item ownership checks, and existing market orders are preserved.

## Files changed
- `client/src/main.ts`
- `server/src/index.ts`

## Compatibility
- No PlayerSchema fields added or removed.
- No migration of player saves, auction files, or market-order files required.
- Existing `auction.json` and `auction_history.json` formats are retained; cancellation adds a new history event with `type: cancelled`.

## Verification
- TypeScript syntax transpilation passed for client `main.ts` and server `index.ts`.
- ZIP integrity checked after packaging.
- Full dependency install, Vite production build, live server test, and browser interaction test were not completed in this environment. Test the auction buy/cancel/listing flows locally before deploying to a shared server.
