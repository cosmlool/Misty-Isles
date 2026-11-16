# Equipment combat effect contract — 2026-11-16

Status: audit artifact, not an approved balance specification. This document separates observed production behavior from decisions required before any migration. It does not authorize enabling currently inactive effects.

## 1. Current production behavior (confirmed)

| Channel | Legacy hunt | Legacy synchronous dungeon | Arena PvP | Typed monster engine |
|---|---|---|---|---|
| Base attributes, weapon attack, armor defense, enhancement | Used by legacy stat formula | Used by legacy stat formula | Separate formula; weapon attack and the single armor defense slot | Consumes supplied base attack/defense |
| Profession coefficients | Legacy attack/defense and profession helpers | Legacy attack/defense and profession helpers | Separate arena coefficients | Profession is used for passive matching; caller supplies final stats |
| Active attack/defense buffs | Legacy totals | Legacy totals | Explicit arena inputs | Supported on combatant buff fields |
| Accuracy / evasion | Selected adapter outputs affect legacy hit calculations | Selected adapter outputs affect boss/player hit calculations | Not part of arena score | Accuracy counters monster evasion; evasion avoids monster hits |
| Healing / lifesteal | Selected legacy outputs | Selected legacy outputs | Not part of arena score | Healing actions and damage-based lifesteal are supported |
| Crit chance / crit damage | Not applied to legacy hit/damage | Not applied to legacy hit/damage | Legacy rare-property crit, profession crit, set crit and crit buff affect score | Supported, but base chance/multiplier are caller-supplied |
| Resistance / control resistance | Not applied as typed player mitigation/control resistance | Not applied as typed player mitigation/control resistance | Not used | Supported against incoming damage and control/passive effects |
| Physical/magic damage, boss damage | Not applied as typed multipliers | Not applied as typed multipliers | Not used | Supported when caller supplies damage type and boss flag |
| Attack speed | Legacy speed derives from dexterity; typed percentage is not used | Same legacy speed projection | Not used | Changes initiative when supplied |
| Health | effectiveMaxHealth uses legacy flat health, structured combatStats.health, and pendant health | Same effective max-health path | Not a PvP score input | Typed engine can scale max HP; do not apply again to a live legacy HP snapshot |
| Loot | Selected legacy loot/drop path | Selected legacy loot/drop path | Not used | No general loot reward settlement in battle resolver |
| Gold / XP / production | Resolved modifier fields are not automatically a reward multiplier | Rewards use explicit pendant/buff calculations; typed gold/XP fields are not automatically applied | Existing gold transfer is separate | Not consumed by the battle resolver |

Notes:
- Production hunt and synchronous dungeon paths still use legacy aggregate combat calculations. resolveMonsterBattle is not called by the production handler path.
- PvP is a deliberately separate rating formula. It receives weapon/armor properties, three-slot set booleans, profession coefficients, buffs and random rolls. It does not receive the full catalog combat-stat modifier set, other armor slots, or amulet effects. Existing regression tests protect this compatibility boundary.
- The stat resolver prepares typed effects from structured catalog stats, parseable armor descriptions, set descriptions, pendant effects, rare properties, weapon profile and buffs. Preparation is not proof that a live mode consumes the result.
- applyFivePieceSetBonus is passed by callers (true for hunt, false for dungeon) but is not read by the typed aggregation calculation. It currently does not establish a runtime difference.
- The typed modifier aggregator sums same-target percentage values additively. The typed battle engine then applies channel-specific caps and multipliers. Legacy base-stat formulas use their own sequence of multiplicative profession, pendant and buff adjustments; those must not be silently replaced by typed aggregation.
- Parsed description clauses are conservative: unsupported or compound descriptions may be ignored. No value or target should be inferred from prose without an explicit mapping.

## 2. Candidate canonical rules (discussion only; not approved)

1. Keep PvP isolated unless a separate PvP balance decision explicitly authorizes new channels.
2. Treat each mode as an explicit allowlist of effect channels; never assume that a field in combatStats is active in every mode.
3. Keep flat base stats and percentage modifiers distinct. Define whether each source stacks additively or multiplicatively and specify the order and cap per channel.
4. Avoid double application: health must have one authoritative max-HP application path; legacy and typed outputs must not both add the same health, attack, defense, loot or lifesteal effect.
5. Keep non-combat reward channels (gold, XP, loot, production) in their existing settlement/reward owners unless a separate economy contract defines stacking, caps, overflow and replay behavior.
6. Preserve current random-call order, battle/round ordering, survival/death semantics, drop rolls and allocation, quest counters, report payloads and idempotency boundaries during any engine migration.
7. Do not infer base crit chance, crit multiplier, accuracy scale, damage type, or profession-to-damage-type mapping from class names or descriptions. Define them explicitly first.

## 3. Decisions required before implementation

- Per-mode allowlist: hunt, dungeon and PvP.
- Canonical source precedence for item structured stats versus description clauses and rare properties.
- Additive/multiplicative stacking and caps for each channel.
- Whether legacy armor descriptions that state max-HP percentages should stack with existing flat/structured health.
- Five-piece tier behavior in hunt versus dungeon, including the meaning of applyFivePieceSetBonus and set mastery.
- Base crit chance/multiplier, accuracy scale, damage type by profession/weapon, and healing-action selection.
- Whether leech means damage-based lifesteal or a post-victory percentage of maximum HP; whether hunter affects drop chance, gold, or both.
- Migration parity requirements for legacy PvE outcomes and all reward/report/quest side effects.

## 4. Safe implementation sequence

1. Obtain explicit approval of the mode/channel table and unresolved semantics.
2. Add pure contract tests for parsing, source precedence, stacking, caps and mode allowlists.
3. Add deterministic parity fixtures comparing current legacy hunt/dungeon outcomes and reward side effects.
4. Implement one mode at a time behind explicit adapters; retain PvP isolation.
5. Compare deterministic fixtures and CI before changing production routing. Do not ship an implicit fallback that activates every catalog stat.

No production combat code, catalog data, coefficients, RNG, rewards, saves or economy were changed to create this document.
