# Dungeon wave runtime integration contract

Status: technical design / audit artifact only. This document does not activate multi-wave gameplay.

## Verified current boundaries

- The versioned `dungeon_encounters.json` schema can describe ordered encounters, ordered waves, and repeated monster spawns. Its validator expands spawn counts deterministically and rejects unknown references and bounded-size violations.
- `resolveLegacyDungeonBossId()` is deliberately narrower: it accepts exactly one encounter, one wave, and one monster spawn. It refuses structures that the legacy combat handler cannot represent.
- Production `dungeonRun` still calls the synchronous `runExpeditionDungeon()` path and resolves one `dungeon.bossId` from `EXPEDITION_DATA.monsters`. It performs one aggregate combat calculation, one drop roll/allocation, and one player settlement.
- The durable run record still has one `encounter.bossId`, one boss-health pair, and one encounter seed. `PreparedDungeonEncounter` likewise records one `bossId` and one aggregate combat result. Neither type currently identifies an encounter index, wave index, active enemy set, or per-wave random state.
- The durable start/round/finalization helpers and result outbox exist, but the production handler does not call the durable start, round, or finalization commit functions. The durable recovery view therefore is not a playable resume flow.
- The durable round planner distributes one precomputed aggregate boss/player damage result over a fixed number of rounds. It does not itself simulate enemy selection, enemy turns, passive transitions, wave completion, or a new wave's combat.

## Required runtime state before enabling waves

A future run format must persist, at minimum:

1. A frozen content identity: schema version, dungeon ID, encounter IDs and ordered wave IDs, plus the exact monster IDs/counts used for this run. A resumed run must not silently adopt edited live content.
2. Encounter and wave cursors, with an explicit active enemy roster and each enemy's current/max health. A single boss-health field is insufficient for multi-enemy waves.
3. Deterministic random state or a fully prepared immutable per-wave result. Restart/retry must never reroll monster actions, drops, or recipients.
4. Per-participant current/max health and status, plus a documented rule for spectator/dead participants and resurrection between waves.
5. A durable transition marker that binds the expected run version/cursor to the next wave, so duplicate or stale messages cannot advance twice.
6. A single terminal settlement marker and outbox events for the entire dungeon run, not one reward claim per wave.

## Required transition and settlement invariants

- Entry consumes one daily attempt for each frozen participant exactly once, in the same durable transaction that creates the run.
- A wave transition is committed only after the prior wave's result is known. The transition stores its next cursor and health snapshots atomically.
- Defeating the last enemy in a wave advances to the next configured wave; defeating the final enemy of the final encounter makes the run eligible for one terminal victory settlement.
- A failed/aborted run cannot issue victory XP, gold, or drops. The approved attempt-consumption rule remains: loss consumes the attempt.
- Drops and recipient allocation are generated once at the approved scope (wave or whole run), persisted before delivery, and never rerolled during recovery. The scope must be explicitly selected before implementation.
- Rewards, quest activity, counters, history, reports, and client result events are committed once at terminal settlement. A per-wave reward policy would be a separate gameplay approval, not an implementation detail.
- The existing three-round win condition, participant survival requirement, and loss health behavior must be mapped explicitly to multiple waves. Do not infer that every wave independently grants a win or that a party can continue after a terminal loss.
- Leader AFK/death and spectator/revival transitions must have deterministic outcomes. Disconnect is not AFK; reconnect must restore the same run and cursor.

## Decisions still required before production wiring

- Whether the three-round limit applies per wave, per encounter, or to the whole dungeon run. Existing approved rule is a maximum of three rounds for a successful dungeon; the multi-wave interpretation must preserve that constraint unless separately changed.
- Whether enemy passives/weaknesses and player buffs are recalculated at each wave boundary or frozen at entry. The legacy combat path calculates one aggregate encounter and has no per-wave boundary semantics.
- Whether drops are rolled per wave or once after the full run, and how the existing random draw order is preserved or intentionally versioned.
- Whether healing/lifesteal occurs after every wave or only after terminal victory. Existing single-boss settlement cannot answer this.
- What happens when a player reaches zero health during an intermediate wave. Existing legacy dungeon health settlement clamps HP to at least one; durable run state also models spectators at zero HP. These contracts conflict and must be resolved with explicit tests.
- What happens when the leader dies or becomes AFK during a multi-wave run, including whether remaining participants can continue and who can finalize.
- How old active durable records (if any) are interpreted when the run schema evolves. A migration/version policy is required; do not coerce unknown records.

## Safe implementation sequence

1. Approve the unresolved gameplay semantics above without changing balance implicitly.
2. Add a versioned durable multi-wave run schema and strict validation, including frozen content snapshots and bounded enemy rosters.
3. Add pure deterministic wave transition logic and tests for order, terminal boundaries, health, duplicate requests, stale cursors, and restart recovery.
4. Add per-wave prepared-combat snapshots that preserve random decisions and legacy formulas where required.
5. Add one WAL transaction for each transition and one WAL transaction for terminal settlement/outbox.
6. Only then wire the production handler behind a compatibility gate; retain the legacy single-boss path for schema-v1 content and prove exact output parity for all four current dungeons.
7. Enable new multi-wave content only after full CI and explicit gameplay approval.

## Explicit non-goals

This design does not authorize new enemy balance, combat coefficients, RNG ordering, loot rates, reward amounts, attempt rules, client protocol changes, or live multi-wave content. The production dungeon handler remains unchanged until the required decisions and parity tests exist.
