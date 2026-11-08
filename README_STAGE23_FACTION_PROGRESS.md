# Misty Isles — Stage 23: Faction Progression Polish

## Changes
- Preserved the existing three-faction system, permanent faction choice, chapter quests, faction bosses, regional events, shops and maximum-rank rewards.
- Added a daily reputation cap for regional-event farming: up to +10 reputation per faction per UTC day, awarded in +2 increments for successful hunts in the active event zone.
- Kept event participation counters tied to successful victories in the active event zone.
- Improved faction cards with a 0–100 reputation progress bar and remaining points to the next rank.
- Clarified the daily event reputation limit in the regional event description.

## Compatibility
- No new PlayerSchema fields.
- Uses existing `quests` and `cityReputation` JSON state, so existing character saves remain compatible.
- No changes to auction, crafting, clan, home, sanctuary, inventory, or combat formulas.

## Verification
- TypeScript syntax transpilation passed for client/src/main.ts, server/src/index.ts and server/src/PlayerSchema.ts.
- Full dependency install/build and browser/server gameplay smoke tests were not run in this environment.
