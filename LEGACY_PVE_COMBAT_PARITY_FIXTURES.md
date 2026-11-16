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


## Detailed coverage audit — 2026-11-16

### Verified existing test ownership

| Concern | Existing test | What is actually locked |
|---|---|---|
| Legacy stat helpers and typed-engine isolation | `server/test/monsterCombat.test.ts` | Passive/weakness/resistance parsing, hit/evasion, healing, profession modifiers, turn order, buff suppression, typed-engine mechanics and stat-adapter behavior |
| Dungeon arithmetic | `server/test/dungeonCombatMath.test.ts` | Solo/party formulas, participant-specific multipliers, max 3 rounds, strict positive-survival boundary, invalid input and DUN-TRIO-01 |
| Dungeon HP settlement | `server/test/dungeonMemberHealthOutcome.test.ts` | Incoming damage → lifesteal → buffer healing order, max-HP caps and loss behavior |
| Dungeon drop RNG and allocation | `server/test/dungeonDropPreparation.test.ts` | Injected RNG, source-order rolls, 95% optional-drop cap, guaranteed drops and recipient allocation order |
| Dungeon reports | `server/test/dungeonGroupCombatReport.test.ts`, `server/test/dungeonMemberCombatReport.test.ts` | Legacy report fields, exact line ordering, personal stats/rewards and input immutability |
| Dungeon quest/history/replay | `server/test/dungeonMemberQuestSettlement.test.ts`, `server/test/dungeonRequestResultPreparation.test.ts` | Detached quest snapshots, bounded request history, stable event identity and no source mutation |
| Dungeon prepared settlement | `server/test/dungeonEncounterPreparation.test.ts` | Frozen prepared result, serialization/revalidation, roster consistency, loot recipient consistency and HP parity |
| PvP isolation | `server/test/pvpCombat.test.ts`, `server/test/pvpRuntime.test.ts` | Separate arena formula and live persistence/reward behavior; not a PvE parity oracle |
| Expedition connection/group safety | `server/test/expeditionSafetyRuntime.test.ts` | Live server, reconnect/disconnect and group participation safety; it is not a golden combat/reward fixture |

### Expedition formula: observed deterministic and random boundaries

The current `expeditionSearchClaim` handler in `server/src/index.ts` performs combat inline. For fixed monster data and resolved player snapshots, its arithmetic is deterministic:

1. Scale monster HP by party size: `monster.hp * (1 + 0.55 * (partySize - 1))`.
2. Sum participant attack after monster defense, profession resistance, profession weakness and passive accuracy multipliers.
3. Calculate rounds with ceiling and a minimum DPS of 1.
4. Calculate group Knight guard and each participant's incoming damage using passive profession damage and evasion/monster accuracy.
5. Win only when rounds are at most 8 and every participant's pre-settlement HP is strictly greater than incoming damage.

The handler currently owns random decisions outside that arithmetic:
- Monster selection: a 5% gatekeeper check after zone clear, otherwise a random candidate selection (or a forced gatekeeper after all candidates have been seen).
- On victory, one random roll per configured optional drop, in source order; gatekeeper fallback may add the first drop if none rolled.
- On victory, one random recipient selection per assigned drop, in drop order.
- No optional-drop or recipient rolls occur on a loss.

The exact call sequence is part of compatibility. A refactor must not move a roll before/after another roll, add a roll for a guaranteed item, or change the number/order of recipient draws. Injected deterministic RNG must be introduced only at a characterization boundary; production must preserve the existing random stream semantics until parity is demonstrated.

### Gaps prioritized for the next implementation stage

**P0 — expedition golden characterization (not yet covered)**
- Extract the arithmetic-only expedition combat plan into a pure helper, preserving the current operation order and formulas byte-for-byte where possible.
- Add solo, duo and trio fixtures with mixed professions, accuracy/evasion, passive resistance/weakness, Knight guard and healing/lifesteal.
- Lock exact rounds, outgoing damage, incoming damage, win/loss and strict HP/8-round boundaries.
- Keep monster selection, optional drop rolls and recipient selection outside the pure helper.

**P1 — stat-resolution closure**
- Add fixtures around the real `resolvePlayerMonsterStats(Player, monster, options)` closure, or a narrow exported adapter, proving weapon/armor/attributes/enhancement/set/rare-property/pendant/buff sources are included exactly once.
- Include legacy armor-description parsing, structured `combatStats`, malformed/compound descriptions and the currently inactive typed channels.
- Do not activate any currently inactive effect as part of this test work.

**P1 — complete expedition settlement characterization**
- With deterministic monster selection and RNG sequence, assert both win and loss snapshots for every participant: HP, battle/victory/kill counters, rare/boss counters, XP, gold, inventory/drop recipient, quest/daily progress, zone seen/cleared/opened state, activity, combat history, report fields and emitted event order.
- Assert that loss consumes no XP/gold/drop rewards, does not progress victory counters, and preserves current HP floor behavior.
- Add replay/retry and persistence-failure assertions without changing the current request/recovery contract.

**P2 — dungeon integration golden fixture**
- DUN-TRIO-01 currently locks the pure math helper, not the complete live `runExpeditionDungeon` settlement. Add an integration fixture only after the expedition characterization boundary is established.
- Lock attempt consumption on both outcomes, participant HP, healing order, XP/gold credit and overflow, drop rolls/allocation, reports, quests, request cache, outbox event identity and persisted player snapshots.

### Safe extraction constraints

- First extraction should move only the deterministic arithmetic; do not move RNG, rewards, quest mutation, report construction, or persistence into the helper.
- Do not alter the legacy inline call order or round/damage rounding. Compare old and extracted outputs on the same fixed input corpus before replacing the inline calculation.
- Keep a copy of representative pre-extraction outputs as golden JSON fixtures.
- Keep the typed battle engine and PvP outside this change. No effect mapping, formula, coefficient, RNG, reward or save behavior is approved by this coverage inventory.
