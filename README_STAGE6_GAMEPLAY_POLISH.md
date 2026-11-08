# Stage 6 — Item and reward polish

This update builds on Stage 5 and focuses on readable item inspection rather than changing combat or server behavior.

## Included
- Equipment comparison in the existing item tooltip when hovering a weapon, armor, or amulet and another item of the same kind is currently equipped.
- Positive/negative differences for attack and defense; a neutral message appears when those stats are unchanged.
- Stronger, more legible rarity colors for rare, epic, and legendary items.
- Subtle hover/focus polish for item cards, respecting reduced-motion preferences.
- No server files or saved player data changed.

## Test
1. Install client dependencies with `npm ci`.
2. Run `npm run build`.
3. Start the game, equip a weapon or armor, then hover another item of the same type in the shop or inventory.
4. Confirm the tooltip shows the equipped item and attack/defense differences. Consumables continue to show their existing description and effects.

The comparison uses the item data already loaded by the client; it does not alter item stats or purchase/equip actions.
