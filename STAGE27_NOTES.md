# Stage 27 — Account Access, Fast Navigation & Trading Cleanup

## 1. Account access

- Added a dedicated login / registration screen.
- Login uses a username and password; usernames are case-insensitive and limited to 3–20 Latin letters, digits, `_` and `-`.
- Passwords are stored as salted scrypt hashes; plaintext passwords are not written to account files.
- Added 30-day bearer sessions with random tokens stored server-side as SHA-256 digests.
- Added guest continuation for testing and existing browser-bound characters.
- Registering from the login screen links the current browser's existing Stage 26 player ID to the new account, preserving that character.
- Added sidebar actions to link a guest character to an account and to log out. Logout revokes the session but does not delete character progress.
- The WebSocket game room now requires a valid session token matching the requested player ID.
- Account HTTP endpoints share the existing Colyseus HTTP server on port `2567`; no second game server or infrastructure migration was introduced.
- Guest-to-account linking requires proof of the active guest session.
- Public player lists use opaque public codes instead of exposing internal player IDs; friend requests, hunt-group invites and PvP challenges resolve those codes server-side.
- Runtime account files (`accounts.json`, `sessions.json`) are created in `server/data` and are intentionally not shipped in the ZIP.

## 2. Navigation and visual performance

- Kept the game as a single-page application; changing tabs does not reload the document or reconnect to the game server.
- Batched multiple render requests into one animation frame to avoid redundant full-screen DOM updates during bursts of server messages.
- Added a simple static account screen and sidebar account/logout controls.
- Disabled CSS animations, transitions and smooth scrolling globally. No decorative or continuous animation is used in this stage.
- The existing game content and data model remain in place; no visual assets were added.

## 3. Trading decision

- Removed the player-to-player buy-order system from the client and server.
- Removed the order storage helpers and message handlers.
- Kept the global auction, its history, listing fees and completed-sale records.
- The city trading district now points players to the auction and economic overview; it no longer offers direct player orders.
- No player gifts, mail transfers or direct item / currency transfers were introduced.

## 4. Existing data compatibility

- Existing player saves remain in `server/data/players.json` and are not included in this archive.
- Existing Stage 26 browser IDs can be preserved by registering from the same browser before clearing site data.
- Guest mode remains browser-bound; if browser storage is cleared, a guest character may become inaccessible.
- Account registration links the current guest player ID; logging in on another device loads the same player ID and saved character.

## 5. Important deployment note

This is an early account system for the current development environment, not a final public-launch security review. Before public release, use HTTPS/WSS, secure cookie/session handling where appropriate, request rate limits, password recovery, account deletion / support procedures, stronger operational logging and a security review. The current client stores the session token in browser local storage so the prototype can reconnect after refresh.

## 6. Verification

- Client TypeScript check passed using a temporary ambient declaration for the unavailable `colyseus.js` package types.
- Server TypeScript check passed using temporary ambient declarations for unavailable Colyseus and Node package types.
- Isolated account API tests passed: guest session, migration registration, login, invalid password rejection, guest access rejection after account linking, and logout revocation.
- ZIP integrity and static asset audit are run before packaging.
- Full Vite production build and live Colyseus / browser playtest could not be completed in this environment because `npm ci` timed out and dependencies were not installed. Please run the included verification script locally and test registration, login, guest continuation, logout, character persistence and the auction.
