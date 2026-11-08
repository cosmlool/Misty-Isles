# Stage 26 — Equipment Catalog & Forgotten Lands Expeditions

## Included content

- New equipment catalog loaded from `server/data/equipment_catalog.json`.
- 50 new weapons, 250 ordinary armor pieces, 35 legendary armor pieces and 11 pendants.
- Seven equipment slots: weapon, helmet, body armor, gloves, boots, cloak and pendant.
- Individual +1…+10 enhancement for weapon and each armor slot.
- 57 five-piece armor sets (50 ordinary and 7 professional legendary sets), with 2/5 through 5/5 set thresholds and separate +0…+10 mastery.
- Legendary armor is craft-only. 35 recipes require Archon trophies and high-tier materials.
- Pendant levels 1…100. Upgrade cost is base crystal price multiplied by the target level; level-100 caps are stored in the catalog and applied by the expedition combat system where relevant.
- Old equipment IDs remain in the item registry for saved characters, active auctions and queued crafting. Legacy gear is hidden from shops and retired gear recipes are removed from the current crafting list.

## Forgotten Lands

Data is stored in `server/data/forgotten_lands.json`.

- 10 sequential locations, recommended levels 1–30.
- 100 monsters: 60 normal, 20 rare, 10 elite, 6 guardians, 3 intermediate bosses and 1 final boss. Their drop tables resolve to 125 unique regional material/trophy item IDs.
- Each location has 9 standard encounters and one gatekeeper. The gatekeeper appears after the character has met 9 distinct standard monsters in that location. Defeating the gatekeeper unlocks the next location. Cleared locations remain farmable; their gatekeeper has a low respawn chance.
- Monster records include level, HP, attack, defense, speed, passive ability, profession weakness, XP, gold and item-drop chances.
- Search timer: 15 minutes. Travel timer: 25 minutes. Both are stored in player quest data so the timers survive reconnects.
- Four branch dungeons are connected to the intermediate/final bosses and can be completed solo or by a hunt group.

## Hunt groups

- Maximum 3 players including the leader.
- Only mutual friends or clanmates can be invited. Friend requests/acceptance are stored in player collections.
- The leader starts search, combat resolution and travel. Members must be online and in the same location; all must meet the location level requirement.
- Monster HP scales by 55% for each additional member. Profession passives provide party synergy: Warrior protection, Buffer party healing, Vampire self-sustain, Gatherer improved drop chance, and damage bonuses for offensive professions.
- XP is awarded to each participant. Gold is divided. Each rolled item is assigned to one random participant; group size does not create extra drop rolls.
- A disconnected member is removed from the active group; the remaining group can continue.

## Compatibility and testing

- No new Colyseus schema fields were added; expedition state, friend lists, pendant levels and set mastery are stored in existing JSON fields.
- Existing character inventory, equipment IDs, auction lots and saved progression are retained.
- Server TypeScript strict check passed using local ambient declarations for the unavailable package typings.
- Client TypeScript check passed using local ambient declarations.
- Vite production build and live browser/server playtest were not run in this environment because project npm dependencies were not installed. Run `npm ci` in both `server` and `client`, then use the existing launch script for an end-to-end test.

## Additional balance hooks

- Weapon primary-attribute bonuses are applied by profession (strength, dexterity, intelligence/wisdom or stamina); the weapon's profile-effectiveness modifier is applied to the relevant combat/support role.
- The 125 regional trophy/material records are unique item IDs, and every monster drop reference resolves to an item in the registry.
- Pendant effects are connected to their matching systems: XP, maximum HP, loot chance, hunting gold, defense, production time, out-of-combat regeneration, critical effectiveness, faction reputation, boss damage and mine crystal chance.
- Armor enhancement levels are included in expedition and Forgotten Lands dungeon calculations.
