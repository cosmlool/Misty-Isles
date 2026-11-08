# Stage 27 — Account & Core UX Foundation

- Added account registration, login, guest continuation and logout.
- Added server-side salted password hashing and expiring sessions.
- Required a valid session for game-room entry.
- Batched UI renders and retained single-page navigation without document reloads.
- Disabled animations and transitions globally for a static, responsive interface.
- Removed player-to-player buy orders; preserved the global auction.
- Preserved Stage 26 player saves and browser IDs for account linking.
