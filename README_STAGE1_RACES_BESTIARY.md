# Misty Isles — Stage 1: Races, Character Portraits & Bestiary Art

This stage integrates local illustrations into the live client, not just as loose reference images.

## Included
- `client/public/assets/characters/race-cat.webp`
- `client/public/assets/characters/race-dog.webp`
- `client/public/assets/characters/race-bird.webp`
- `client/public/assets/characters/race-rodent.webp`
- NPC portrait crops, common monster art and boss art in the same directory.
- Race-specific artwork on character creation cards, the persistent sidebar avatar and the character-page hero portrait.
- A bestiary gallery on the Hunting page using local monster/boss artwork.
- No server gameplay handlers or player save data were intentionally changed.

## Install / verify
1. Back up the existing project and `server/data`.
2. Extract this archive into a separate test directory.
3. In `game/client`, run `npm ci`, then `npm run build`.
4. Start server and client as usual; check character creation, character page, sidebar portrait, and Hunting > Bestiary.

## Scope
This is stage 1 of the art rollout: races, character portraits, NPC samples, and a bestiary gallery. The images are cropped from the approved concept art board, so some cards retain a little of the concept-board framing. Later stages should replace these with individually composed transparent portraits and dedicated location scenes. The complete production build could not be run in the preparation environment because `npm ci` timed out; validate the build locally before replacing your working installation.
