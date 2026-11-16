# Legacy PvE combat parity fixture inventory — 2026-11-16

Status: characterization only. This file records the current legacy behavior and its test coverage; it is not a new combat design or permission to activate additional item effects.

## Production paths reviewed

### Expedition hunt

- The live claim handler is `GameRoom`'s `expeditionSearchClaim` in `server/src/index.ts` (around line 810 at the reviewed HEAD).
- It resolves each player's legacy totals through `resolvePlayerMonsterStats()`, then calculates group HP scaling, total DPS, rounds, group guard, incoming damage and win/loss inline.
- The live hunt formula consumes the selected legacy channels: attack, defense, accuracy, evasion, profession/passive resistance, profession weakness, healing, lifesteal and loot.
- Monster selection, optional drop rolls and recipient selection use `Math.random()` in the handler. The combat calculation itself is deterministic for a fixed monster and fixed player snapshots.
- There is no standalone pure expedition-combat-plan function today. Existing `expeditionSafetyRuntime.test.ts` covers disconnect/group participation safety, not a full deterministic hunt settlement fixture.

### Synchronous dungeon

- The live `runExpeditionDungeon()` path is in `server/src/index.ts` (around lines 726–730 at the reviewed HEAD).
- Player stats are resolved by the same `resolvePlayerMonsterStats()` adapter, then passed to the pure `calculateDungeonCombatPlan()` in `server/src/dungeonCombatMath.ts`.
- The math helper owns no game data and no RNG. Drop rolls and recipient allocation occur after the combat plan is calculated.
- The live path remains synchronous and persists final player results plus outbox events. This inventory does not wire the separate durable multi-round dungeon lifecycle into live combat.

### Shared player stat resolution

- `resolvePlayerMonsterStats()` in `server/src/index.ts` resolves the equipped catalog items, attributes, enhancements, set tiers, rare properties, pendant and active buffs before calling `calculatePlayerMonsterCombatStats()`.
- `calculatePlayerMonsterCombatStats()` in `server/src/monsterCombatStats.ts` preserves legacy attack/defense/speed/loot/lifesteal outputs while preparing separate typed modifiers.
- Unit tests cover the pure stat helper and adapter, but do not execute the complete `Player`/catalog resolution closure inside `index.ts`.

## Deterministic fixture added

### DUN-TRIO-01 — three participants, mixed modifiers

Added to `server/test/dungeonCombatMath.test.ts`:

| Input | Value |
|---|---:|
| Dungeon power | 500 |
| Party size | 3 |
| Boss defense / attack | 20 / 100 |
| Group guard | 0.08 |
| Participant attacks | 30, 40, 25 |
| Participant defenses | 20, 30, 10 |
| Participant HP | 100, 120, 90 |
| Outgoing multipliers | 0.9×0.95×0.8, 1×0.7×1, 1×1×1 |
| Incoming profession / hit multipliers | 1×1, 0.9×1.1, 1.1×0.95 |

Expected result:

- Rounds: **3**
- Incoming damage: **[33, 30, 37]**
- Damage by participant: **[359.1, 490, 437.5]**
- Result: **win**
- Boundary assertion: if participant 3 has exactly 37 HP before the hit, the result is a loss. Survival is strictly greater than incoming damage.

The fixture injects no RNG and does not change production combat code or formulas.

## Existing characterization coverage

- `server/test/monsterCombat.test.ts`: monster passive registry and parser; legacy resistance, hit, healing and profession helpers; all current profession stat baselines; enhancement application; armor attributes; typed modifier separation; adapter normalization; HP-ratio conversion; and deterministic typed-engine cases. Typed-engine tests do not establish that the typed engine is used by live hunt or dungeon.
- `server/test/dungeonCombatMath.test.ts`: legacy solo and duo dungeon math, participant-specific multipliers, strict survival and the three-round victory boundary, invalid inputs, plus DUN-TRIO-01.
- `server/test/dungeonMemberHealthOutcome.test.ts`: incoming damage, health floor, lifesteal and buffer-healing order.
- `server/test/dungeonDropPreparation.test.ts`: guaranteed/optional drop order, chance cap and recipient allocation.
- `server/test/dungeonGroupCombatReport.test.ts` and `server/test/dungeonMemberCombatReport.test.ts`: legacy report fields, values and line ordering.
- `server/test/dungeonMemberQuestSettlement.test.ts`, `server/test/dungeonEncounterPreparation.test.ts` and `server/test/dungeonRequestResultPreparation.test.ts`: detached quest/history/request snapshots, prepared settlement validation and stable event identity.
- `server/test/pvpCombat.test.ts`: the separate legacy arena PvP formula and its explicit inputs. PvP is not part of this PvE fixture set.

## Explicit gaps — do not mistake these for verified parity

1. The full live expedition hunt calculation and settlement still have no pure golden fixture. The inline formula is visible in `index.ts`, but the existing runtime safety test is not a substitute for a combat/reward parity test.
2. The complete `resolvePlayerMonsterStats(Player, monster, options)` catalog-to-stat wiring is source-reviewed, not covered by a focused end-to-end fixture. Pure helper tests do not prove every catalog source reaches the live handler exactly once.
3. No single runtime fixture currently compares a complete hunt/dungeon result across combat, RNG call order, drops, player HP, rewards, quest counters, reports and persistence.
4. Typed monster combat tests cover the newer engine in isolation. They do not authorize routing production hunt/dungeon through it.

## Safe next step

Build an isolated characterization harness for the existing expedition formula and the full player-stat resolver before considering any engine migration. The harness must compare fixed inputs and outputs without changing the live formula, RNG calls, reward allocation, quest/history/report behavior or save semantics. Any later production routing change still requires a separate compatibility review and explicit approval of unresolved effect mappings.
