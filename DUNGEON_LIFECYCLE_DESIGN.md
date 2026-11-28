# Dungeon lifecycle — technical design and audit findings

Status: design/audit only; no dungeon lifecycle behavior is claimed as implemented.

## Scope

This document covers the party boss-dungeon entry handled by `dungeonRun` / `runExpeditionDungeon()`. It does not silently change the separate 15-minute expedition search and travel flows.

## Confirmed current implementation

- `runExpeditionDungeon()` validates the party, calculates the complete encounter, applies damage/rewards/loot, persists player snapshots, and sends results in one synchronous handler.
- There is no durable active-dungeon record, no per-run participant state, no spectator lifecycle, and no 60-minute AFK watchdog.
- `HUNT_GROUPS` / `PLAYER_GROUP` persist party membership separately through the shared state transaction store.
- `onLeave()` handles disconnect and party/expedition cleanup, but it cannot abort or resolve a durable dungeon run because no such run object exists.
- The existing group runtime test covers immediate win/loss, reward persistence, idempotent request replay, daily attempt limits, and group loot distribution. It does not cover active-run transitions, spectators, AFK, or restart recovery.

## Approved gameplay invariants to preserve

1. Party size remains at most three; leader succession is never allowed.
2. Voluntary party leave is forbidden while a dungeon run is active.
3. Voluntary leave is available outside the dungeon, during party gathering, or after the run ends.
4. If the leader leaves voluntarily outside the dungeon, the whole party disbands.
5. Ordinary dungeon completion preserves the party.
6. A dead ordinary member without a resurrection is a spectator; the other members may continue.
7. If the leader dies and cannot be resurrected, the entire party exits the dungeon, but the party itself remains assembled.
8. If the leader is inactive for 60 minutes during a dungeon, stop the run, send everyone to the city, disband the party, and do not appoint a successor.
9. Resurrection rules remain separate: one scroll revives one other member; a rescuer cannot revive the same ally twice in one run; inventory cap two; no shop inside the dungeon.

## Proposed server-side run model

A durable `DungeonRun` record should be independent of the party roster and include:
- `runId`, `groupId` (nullable for solo), `dungeonId`, `leaderId`;
- immutable ordered `participantIds` captured at entry;
- `status`: `active | completed | aborted`;
- `startedAt`, `updatedAt`, and a server-owned encounter/round state;
- per participant: `status: alive | spectator | revived`, current HP, and last meaningful activity timestamp;
- per rescuer: set of participant IDs already resurrected during this run;
- durable request/idempotency key and terminal result reference.

The party roster must not be used as the source of truth for participants in an already-started run.

## Required transition rules

- Entry: validate the entire party and all daily attempts, then atomically create the run and freeze its participant list before the first encounter action.
- Active run: reject party leave, invite, accept, and roster mutations for every participant.
- Member death: mark only that member as spectator; never silently remove them from the party roster.
- Leader death without successful resurrection: terminate the run and return all participants to the city; retain the party.
- Normal completion: mark the run terminal, persist results exactly once, return participants to the city, and retain the party.
- Leader AFK >= 60 minutes: atomically abort the run, return all participants to the city, disband the party, clear all player-to-group references, and invalidate outstanding group invites. Never transfer leadership.
- Every terminal transition must be idempotent; retries must not duplicate attempts, damage, rewards, loot, or notices.

## Persistence and crash consistency

The run record, participant state, player snapshots, party changes, attempt consumption, and terminal rewards must commit through one recoverable transaction boundary. A process restart must never resume an ambiguous partially-applied encounter or award twice.

Approved restart policy: an active run resumes from its latest committed snapshot after a process restart. It is not restarted from round zero, and a committed daily attempt is not charged a second time.

## AFK signal requirements

A periodic network keepalive is not proof of player activity. The future activity signal must represent meaningful client interaction, be authenticated against the current room session, and be timestamped by the server. The server owns the 60-minute threshold and timeout decision. Do not trust a client-supplied timestamp.

## Implementation sequence

1. Extract a deterministic dungeon-run state machine and transition tests without changing combat balance.
2. Add durable run storage and shared-WAL integration, including crash/replay tests.
3. Refactor dungeon combat from one synchronous calculation into resumable encounter steps, preserving existing formulas and reward semantics.
4. Add spectator/death and resurrection transitions.
5. Add authenticated meaningful-activity tracking and the leader AFK timeout.
6. Add integration tests for leader AFK, ordinary member death, leader death, normal completion, disconnect, restart recovery, duplicate requests, and no leadership succession.

No numeric combat coefficients or reward balance are to be changed as part of this refactor.


## Approved crash/restart policy

An active run resumes from its latest committed snapshot after a process restart. It is not restarted from round zero, and a committed daily attempt is not charged a second time.

Implementation foundation added:
- `dungeon_runs.json` is now a shared-WAL target, so a run snapshot can be committed atomically alongside player snapshots, group roster, and other shared state.
- Startup replays the shared WAL before parsing active dungeon records.
- `dungeonRunState.ts` defines a versioned run snapshot, frozen participant IDs, per-player health/status/activity/resurrection history, boss health, round index, deterministic encounter seed, and durable terminal result.
- Startup validation fails closed on malformed or ambiguous active-run records instead of silently discarding them.
- Unit tests cover frozen rosters, per-participant round snapshots, exact serialization/recovery, terminal idempotency, and invalid-state rejection. Shared-WAL crash recovery now also verifies replay of a dungeon snapshot written in the same transaction as player/group state.

Important limitation: the current boss dungeon handler is still synchronous and has not yet been refactored to create, advance, and commit these records. The new durable model is the foundation, not a claim that active dungeons already resume in production. Next implementation step is to replace the one-shot handler with a deterministic round/step resolver that commits the entire game snapshot after each step before exposing it to clients.


## Resurrection scroll shop integration

- Added the resurrection scroll as a 100-crystal shop item.
- The server purchase path allows purchase only while the character is in a city and not listed in an active dungeon run.
- Inventory capacity is enforced at two scrolls; purchase deducts crystals and appends exactly one scroll.
- Pure inventory helpers and tests cover purchase, capacity, city/active-run restrictions, and consuming exactly one scroll while preserving unrelated inventory.
- Runtime resurrection is not yet wired: the synchronous dungeon handler still has no active-run action loop in which a participant can select a fallen ally. The consumption helper is prepared for the atomic revive transaction, but no claim is made that a player can use a scroll in combat yet.


## Atomic resurrection snapshot preparation

- Added `dungeonRevivalTransaction.ts` to prepare the rescuer's updated inventory and the revived dungeon participant state as a paired snapshot.
- The helper validates the rescuer inventory, delegates party/status/duplicate-rescue checks to the dungeon state transition, and removes exactly one scroll without mutating the caller's input objects.
- The caller must persist both returned snapshots (`players` and `dungeonRuns`) in the same shared-WAL transaction. A dedicated crash test interrupts the write after the player file and verifies restart replay restores both the consumed scroll and revived participant state.
- This is transaction preparation and WAL-level recovery coverage, not yet a live combat command. The active dungeon handler remains synchronous; the next runtime step must create and advance durable run records before a player-facing revive action can be enabled.


## Deterministic resumable round plan

- The durable run model now optionally carries a validated round plan: total rounds, next unresolved round, boss-damage slices, and per-participant incoming-damage slices.
- Aggregate integer damage is divided deterministically across rounds using cumulative floors. The sum of all slices is exactly the original aggregate damage; no combat coefficient or total damage is changed by the split.
- `resolveNextDungeonRunRound` applies exactly one saved slice, advances the round cursor, updates participant HP and boss HP, and returns a new immutable run snapshot. A serialized snapshot resumes from the next unresolved round.
- Tests cover exact damage conservation, one-round-at-a-time progression, serialization/recovery between rounds, terminal exhaustion, and malformed plans.
- Scope limitation: this is the deterministic resumable round engine and persisted plan format. The production `runExpeditionDungeon()` handler still resolves the encounter synchronously and does not yet create/commit this plan or expose a round action to clients. Runtime wiring and preserving the current reward/loot/idempotency behavior remain the next integration task.


## Atomic dungeon entry preparation

- Added `dungeonRunStartTransaction.ts` as a pure preparation layer for the entry transaction. It freezes the participant roster in a validated run record and prepares the matching player snapshots with daily attempt and battle counters updated together.
- A repeated request with the same durable run identity returns the existing run without incrementing attempts or battles again. Reusing a request ID for a different run, overlapping an active run, malformed player snapshots, or exhausted daily attempts rejects the entire preparation.
- Tests cover daily reset, party-wide attempt charging, retry idempotency, active-run overlap, attempt limits, and input immutability.
- The helper is not yet called by `runExpeditionDungeon()`; production entry remains synchronous until the runtime integration stage. The next step is to wire this preparation into the shared WAL and then add durable round continuation/finalization without changing combat or reward formulas.


## Shared-WAL dungeon entry commit

- Added `commitDungeonRunStart`: the prepared player snapshots (daily attempt and battle counters) and the active run record are now submitted together as one shared-WAL transaction.
- If startup recovery replayed a newer committed snapshot, entry preparation fails closed and asks the caller to reload player/run state before retrying. This prevents a stale in-memory snapshot from overwriting recovered data.
- Idempotent retries of the same request do not write a second attempt charge. Invalid battle counters are rejected before serialization.
- A process-crash test interrupts the WAL after the player file is written and verifies recovery restores both the attempt charge and active dungeon run.
- The runtime transaction helper is still not called by `runExpeditionDungeon()`. The live handler remains synchronous; this stage hardens the durable transaction boundary and tests it without claiming the production dungeon has become resumable.


## Extracted deterministic combat calculation

- Added `dungeonCombatMath.ts` as a pure calculation boundary for the existing boss-dungeon combat formula.
- The live handler now supplies already-resolved passive, weakness, profession, and evasion multipliers to that helper; it still uses the same attack/defense coefficients, party scaling, Knight guard, three-round victory condition, incoming-damage floor, and HP comparison.
- The helper returns the original round count, incoming damage per participant, victory decision, and each participant's aggregate outgoing damage. Combat reports now read their damage value from this shared result rather than duplicating the formula.
- Dedicated tests cover the legacy calculation, party scaling, damage flooring, and strict survival threshold.
- This is a formula extraction and test seam only. The handler still executes the whole encounter synchronously; no durable round commits, reward timing, loot timing, or client round actions are wired yet.


## Shared-WAL dungeon round and player-health commit boundary

- `commitDungeonRunRound` validates the stored run, checks the expected round index, resolves exactly one preplanned round, and commits both the updated `dungeonRuns` and matching `players` snapshots through one shared WAL transaction.
- Participant HP is copied from the resolved durable run into the corresponding player snapshots. Missing player snapshots or invalid HP fail closed before the WAL is written.
- A retry using an old round index is rejected, preventing duplicate round damage. If shared-state recovery occurred during the operation, the helper refuses stale in-memory state and requires both player and run snapshots to be reloaded.
- Crash coverage interrupts execution after the player snapshot write and verifies journal replay restores both player HP and dungeon encounter progress.
- Scope limitation: this is an atomic persistence boundary and test foundation, not production runtime wiring. The synchronous `runExpeditionDungeon()` handler still does not create/advance durable rounds through this helper. Reward/loot finalization, idempotent event delivery, and live handler replacement remain outstanding; no claim is made that dungeon rounds are now restart-resumable in production.


## Shared-WAL dungeon finalization foundation

- `dungeonRunFinalizationRuntime.ts` prepares terminal outcomes against an expected round index and run timestamp, then commits `players.json` and `dungeon_runs.json` in one shared-WAL transaction.
- The durable terminal result carries a deterministic claim ID bound to run ID, original dungeon request ID, and outcome. A duplicate same-outcome retry is a no-write operation; a conflicting outcome is rejected.
- Finalization refuses stale snapshots, missing participant snapshots, unresolved planned rounds, and any retry after shared-state recovery until both snapshots are reloaded.
- Crash coverage interrupts after the player file write and verifies WAL replay restores both player reward snapshots and the terminal run marker.
- This is a persistence foundation only. The live `runExpeditionDungeon()` handler still calculates and mutates rewards synchronously and is not wired to this helper. Reward calculation, loot selection/distribution, report construction, event delivery/outbox semantics, and live-handler replacement remain outstanding. No reward formula, chance, or balance value was changed.


## Durable dungeon result outbox foundation

- The shared WAL now supports `dungeon_outbox.json`; terminal run state, post-reward player snapshots, and queued result messages can be committed in the same transaction.
- Result events have deterministic IDs bound to the run and recipient. Repeated finalization cannot enqueue a second copy or replace an existing event payload.
- Delivery acknowledgement is persisted separately after transport send. The new reconnect dispatcher filters by recipient, sends only pending events, and acknowledges only after `client.send` returns. A fresh outbox snapshot is loaded before each acknowledgement to avoid overwriting newer event state.
- Delivery is at-least-once: a crash between socket send and acknowledgement can replay an event. Client deduplication by `eventId` is implemented in `client/src/dungeonResultDedup.ts` and runs before UI side effects; it remembers up to 500 event IDs per player in browser storage, with an additional session-level set.
- The dispatcher is wired to player join/reconnect. The live synchronous `runExpeditionDungeon()` handler now writes each participant's `combatResult` event to the outbox in the same shared-WAL transaction as the updated player snapshots, then dispatches pending events and acknowledges them after send. The newer durable dungeon-run round/finalization helpers remain a separate foundation not yet used by the live combat calculation. At-least-once replay still requires client-side deduplication by `eventId`. No reward formula or balance change is included.



## Reconnect visibility and duplicate-entry guard

- Added a participant-scoped recovery projection for an active durable run. It exposes the run/dungeon identifiers, leader flag, committed round cursor, timestamps, and participant HP/status; it does not expose the encounter seed or internal round damage plan.
- On authenticated join, the server sends the recovered run projection (or an explicit null) so a reconnecting client can clear stale UI state and show the saved run.
- The dungeon screen displays the saved run and disables new dungeon-entry buttons while that projection is present. The server independently rejects a second entry for a participant already present in an active durable run.
- Multiple active records for one participant fail closed instead of selecting an arbitrary run. The recovery projection is available only to a participant in that run.
- Tests cover active/terminal lookup, privacy of the projection, and ambiguous active-run rejection.
- Important limitation: the production synchronous dungeon handler still does not create/advance durable run records. This stage makes already-persisted active runs visible and prevents duplicate entry if one exists; it does not yet resume combat rounds or turn a restored run into a playable encounter. The next stage is live entry/round integration with the existing WAL start and round commit helpers.


## Party-wide active-run entry guard

- Strengthened the server-side dungeon-entry guard to inspect every frozen party member, not only the requesting leader.
- A party is rejected if any member is already present in an active durable dungeon run. The notice identifies the blocked member; the existing cached-request replay path remains ahead of this guard so an idempotent retry can still return its saved result.
- Added validation for unique, non-empty party IDs and tests proving a non-leader's active run blocks the whole new party.
- This closes an overlap hole in the reconnect visibility foundation. It does not change the current synchronous combat handler or claim that live combat is resumable; production durable entry/round integration remains outstanding.


## Startup validation for overlapping active dungeon runs

- Startup now validates the complete recovered dungeon-run store for cross-run participant overlap after shared-WAL replay and before accepting sessions.
- If a player appears in two active durable runs, the server fails closed immediately rather than waiting for that player to reconnect and discovering the ambiguity later.
- Completed/aborted history does not block a new active run. Tests cover both overlapping active records and valid disjoint/terminal records.
- This is a recovery-integrity guard; it does not yet connect durable entry, round advancement, or finalization to the live synchronous dungeon handler.


## Durable snapshot invariant hardening

- Startup and transaction validation now require the round-plan cursor to match the committed run round index. A snapshot that claims different next-round positions is rejected rather than resumed ambiguously.
- Participant snapshots must contain exactly the frozen roster: no missing participant and no extra player record. Health must remain within the participant's maximum; spectators must have zero HP, while alive/revived participants must have positive HP.
- Boss snapshots now require a valid boss ID and deterministic seed, positive maximum HP, and current HP within the saved maximum.
- Run timestamps cannot move backward from start to update time. New run creation rejects participant HP outside the valid positive range.
- Added regression tests for cursor drift, extra participant entries, impossible participant/boss HP, and invalid initial health.
- This strengthens persisted-state validation only. It does not wire the synchronous production dungeon handler to durable entry/round/finalization, and it does not change combat or reward calculations.


## Live-handler integration audit — 2026-11-13

The current `runExpeditionDungeon()` implementation was re-read at the production call site before attempting runtime wiring. The following ordering is confirmed:

1. It validates the leader, online party roster, request ID, cached result, existing active-run guard, leader level, group level range, and daily attempt availability.
2. It resolves the boss, participant combat stats, passive/weakness multipliers, and calls `calculateDungeonCombatPlan()`. That pure function returns the aggregate round count, incoming damage, victory flag, and aggregate outgoing damage.
3. It rolls optional boss drops with `Math.random()` and chooses the recipient of every drop with `rand()`. The guaranteed dungeon resource is also added to the pending drop list.
4. It increments each online participant's daily dungeon-attempt counter and battle counter in memory.
5. It applies the entire aggregate incoming damage in one operation. On victory only, it then applies lifesteal/Buffer healing, kill counters, XP/gold, activity history, and loot inventory changes. On loss, it applies damage and loss activity without victory rewards.
6. It builds per-player reports and cached request history, then calls `persistDungeonResultPlayers()` to commit player snapshots and result outbox events. Client notifications are sent after persistence.

### Integration blockers confirmed in code

- The production handler does not call `commitDungeonRunStart()`, `commitDungeonRunRound()`, or `commitDungeonRunFinalization()`. The durable helpers remain separate from the live encounter path.
- `DungeonRoundPlan` currently stores only boss-damage slices and incoming-damage slices. It does not freeze the already-calculated `win` decision, post-damage healing, or terminal settlement data.
- The durable run's `encounter.seed` is currently an opaque persisted string. The live drop roll and loot-recipient selection use `Math.random()`; they are not derived from that seed and are not stored in the run.
- `commitDungeonRunRound()` synchronizes participant HP into player snapshots, but it intentionally does not apply the live handler's victory counters, healing, XP, gold, inventory, reports, or quest history. Advancing rounds through it and then invoking the old handler would therefore be an unsafe mixed execution path.
- `commitDungeonRunFinalization()` is a transaction boundary, not a reward engine: it accepts caller-prepared player snapshots and outbox events. The caller must calculate and freeze the exact legacy settlement before committing it.
- The live handler increments attempts in its in-memory player objects before the final persistence call. If a durable entry transaction is added without removing/replacing that mutation path, attempts and battle counters can be charged twice. Conversely, persisting entry and then allowing the old handler to complete independently can leave an orphan active run or conflicting terminal state.

### Required shape of the next implementation

Do not add a partial call to the durable entry helper to the current handler. Before runtime wiring, introduce one explicit immutable encounter/settlement preparation boundary that captures, at minimum:

- the original request identity and ordered participant roster;
- the exact legacy combat result (`rounds`, `win`, aggregate incoming damage, and aggregate outgoing damage);
- all random outcomes that affect the result, including selected drop IDs and each drop recipient;
- the legacy post-combat healing and resulting per-player HP;
- the exact per-player XP/gold and victory counters, plus the resulting inventory/quest/report/outbox payloads needed for terminal commit.

The durable start transaction must consume the daily attempts exactly once together with this prepared run. Round commits must advance only the saved plan. Finalization must apply only the frozen settlement and terminal marker in one WAL transaction. A retry must load the committed request/run state rather than reroll drops, recalculate against changed equipment/buffs, or apply rewards again.

### Safe boundary for the current stage

This stage is an implementation audit and sequencing correction only. It changes no combat formula, drop chance, loot distribution rule, reward amount, attempt limit, or live dungeon behavior. The next code change should first add and test the immutable preparation/settlement model against the existing synchronous handler's outputs; only after parity is demonstrated should the handler be switched to durable entry/round/finalization transactions.

## Additional live-handler audit — request identity and recovery UI — 2026-11-15

- The legacy `runExpeditionDungeon()` request cache stores only `{ id, report, text }` in each player's `dungeonRequestHistory` (last five entries) and `dungeonLastRequest`. It does not bind the request ID to `dungeonId`, `groupId`, `leaderId`, or the ordered participant roster.
- The live handler treats a request as cached when any participant has the same request ID. In that case it returns early and re-sends the cached result only to participants whose own cache matches; it does not verify that the current dungeon/group identity matches the original request. This does not by itself prove duplicate rewards, but it can suppress a legitimate new group request and leave members with different UI outcomes if a client reuses an ID across identities.
- `resolveDungeonRequestRecovery()` provides the stronger durable identity check for `dungeon_runs` (dungeon, group, leader, and ordered roster), but `server/src/index.ts` does not import or call it. The current legacy cache is therefore separate from that safer resolver. The five-entry history limit also means it is not an indefinite server-side idempotency ledger.
- The official client persists one pending `{ id, requestId }` per player and re-sends it after a retry; it prevents switching to another dungeon while that pending request exists. This reduces accidental ID reuse in the official UI, but is not a server-side identity guarantee for multiple devices or custom clients.
- The client renders a saved-run card and disables new dungeon-entry buttons when `dungeonRunRecovery` is non-null. There is currently no player-facing resume/advance/abort action in that screen. Since production does not create active durable run records yet, this is a dormant recovery UI; once durable entry is wired, the resume controls must be delivered in the same integration milestone so a recovered player is not stranded.
- Do not patch the legacy cache independently as a partial workaround while the durable run identity flow is being designed. The immutable prepared-run identity should become the single authoritative idempotency record during the planned handler migration; add cross-player mismatch, ID-reuse, and >5-subsequent-entry retry tests at that point.

## Resurrection snapshot consistency and death semantics — 2026-11-15

- Review of `prepareDungeonRevival()` found that it updated the durable run participant HP and consumed the rescuer's scroll, but left the target's `players.json` health unchanged. A reconnect between revival and the next round could therefore load stale/zero Player HP while the run record said the participant was revived.
- Fixed the pure preparation helper to require both rescuer and target player snapshots and to write `target.health = reviveHealth` in the same returned player snapshot as the rescuer inventory change. Regression tests now assert target HP synchronization, input immutability, JSON round-trip, and missing-target rejection. Commits: `303d139411b40328190e27569d0b839925bb7074`, `7f7d89c0d35203e6e94ec3efd6a267368967f02d`.
- This helper remains a preparation layer and is not yet called by the live dungeon handler; the fix prevents a future integration defect but does not make revival playable today.
- Death semantics still need a deliberate integration decision: the legacy `prepareDungeonMemberHealthOutcome()` and durable `resolveNextDungeonRunRound()` both clamp a participant's HP to at least 1, while the lifecycle design includes a spectator state and explicit death transition. The current aggregate victory condition also requires every participant to survive incoming damage. Do not silently change this behavior during refactoring; define exactly when a participant becomes a spectator and how that interacts with group victory, leader death, and resurrection before switching the live handler.


## Dungeon content configurability audit — 2026-11-16

The production dungeon content contract was traced from server/data/forgotten_lands.json into DUNGEONS and the live runExpeditionDungeon() handler.

Confirmed:
- The data file currently defines four dungeons. Each record has min, power, xp, gold, resource, bossId, and rooms.
- rooms contains three human-readable room labels per dungeon (two descriptive stages and a final boss label). It is not an encounter roster: no monster IDs, per-room spawn counts, wave definitions, or room combat settings are present.
- The live handler resolves exactly one monster by dungeon.bossId and passes that boss plus dungeon.power to calculateDungeonCombatPlan(). It does not iterate rooms, spawn intermediate monsters, or run multiple combat encounters.
- The existing rooms values therefore describe dungeon flavor/progression but do not control the number of enemies fought. Changing the number of strings in rooms alone will not change combat.
- The existing fields min, power, xp, gold, resource, and bossId are live inputs to entry checks, combat calculation, rewards/drop selection, and boss resolution respectively. Changes to these values can affect live gameplay immediately and require parity/balance tests.
- The current data contract has no dedicated monsterCount, waves, encounters, spawns, or per-room reward configuration. A requested multi-mob dungeon cannot be implemented as a data-only edit to the current schema.

Prepared but not live:
- The immutable prepared-encounter model can freeze the legacy aggregate combat result, selected drop IDs/recipients, per-participant settlement and player snapshots.
- The durable start/round/finalization helpers provide tested WAL boundaries, but the production handler still does not call them. The live handler remains one synchronous boss encounter. The durable outbox is integrated for result delivery, which is separate from resumable run progression.
- The prepared encounter and durable run foundations do not yet implement configurable waves or multiple sequential enemies.

Safe next implementation sequence:
1. Define a versioned dungeon content schema with explicit ordered encounters/waves and explicit enemy references/counts; keep legacy rooms presentation-only or migrate it with a deliberate compatibility rule.
2. Validate every referenced monster and every count/round/reward field at startup; reject invalid content rather than silently skipping enemies.
3. Add pure encounter expansion tests for exact enemy count, ordering, duplicates, missing IDs, and boundary counts.
4. Build a legacy single-boss adapter that maps each existing dungeon to exactly its current boss encounter and current rewards. Golden tests must prove current four dungeons remain behaviorally identical.
5. Only then add multi-enemy/wave execution and connect the prepared immutable settlement plus durable run lifecycle. Freeze all random outcomes and settlement before WAL commit; never reroll on retries/restarts.
6. Add full live runtime tests for multiple enemies/waves, party distribution, victory/loss, attempt charging, quest/history/report/outbox delivery, crash recovery and idempotency.

No gameplay code, dungeon data, combat formula, RNG, rewards, economy, save format, or client behavior changed in this audit. Do not treat rooms as a working wave system.


## Versioned encounter configuration foundation — 2026-11-16

Added server/data/dungeon_encounters.json with schemaVersion 1 and an explicit ordered encounter/wave/spawn structure. All four current dungeons are represented as one encounter, one boss wave, and exactly one spawn of their existing bossId. The config is intentionally not consumed by the production dungeon handler yet.

Added server/src/dungeonEncounterConfig.ts:
- Strict schema-version, ID, known-dungeon, known-monster and full dungeon-coverage validation.
- Rejects duplicate dungeon/encounter/wave IDs, empty encounters/waves/spawns, duplicate monster entries within one wave, non-safe/non-positive/oversized spawn counts, more than 20 waves per encounter, and more than 100 expanded monsters per dungeon.
- Expands counts into a deterministic ordered monster ID list without RNG or side effects.

Added tests for legacy four-dungeon boss parity, ordered wave expansion, invalid versions/references/counts, duplicate/empty/oversized input, and the actual checked-in JSON against forgotten_lands.json. The new test is registered in the server test script.

This is a configuration/schema foundation only. It does not create rooms or multiple fights in production, alter combat, RNG, rewards, saves, client protocol, or balance. Production integration remains a later stage after lifecycle and settlement parity are designed and tested.


## Legacy boss adapter boundary — 2026-11-16

Added resolveLegacyDungeonBossId() to the pure encounter config module. It projects a validated expanded definition into the old single-boss contract only when it contains exactly one encounter, one wave and one monster spawn. Multi-encounter, multi-wave or multi-monster content fails closed instead of being silently truncated. Regression tests assert the four configured dungeon boss IDs and all rejected shapes.

The adapter is intentionally not wired into runExpeditionDungeon yet. The production handler continues reading the existing dungeon.bossId directly, preserving current combat calculations and execution order while this boundary is characterized. The Quality Gate for the previous config commit exposed one incorrect test fixture: a count of 101 violated the per-spawn cap before reaching the total-dungeon cap. The fixture now uses six legal 20-monster waves to exercise the aggregate cap correctly.


### CI follow-up — 2026-11-16
Quality Gate 43931230374 exposed a literal escaped newline accidentally inserted into the aggregate-limit test while preparing the adapter regression. Corrected the test source to use an actual line break. The subsequent commit is awaiting its own Quality Gate; no production combat code was changed.


### CI correction — 2026-11-16 (follow-up)
The subsequent Quality Gate 43936898345 showed that the earlier newline correction had not actually removed the literal `\\n` from the checked-in test source. Replaced the literal two-character escape with a real source line break in commit dca7f4e3b8b3bf57237835cdc4e777225c813c77. The new run 43946425041 has data/docs and client jobs passing; server and Playwright jobs were still in progress at the latest check. No production runtime behavior changed.


Append the wave runtime integration contract and current implementation boundaries. See `DUNGEON_WAVE_RUNTIME_CONTRACT.md` for required state, invariants, unresolved gameplay decisions, and staged wiring sequence. Verified that the current config/legacy adapter are pure schema boundaries; production still executes one synchronous `bossId` encounter and the durable run types still store one boss and one aggregate result. No live combat behavior changed.



## 2026-11-28 — статус atomic settlement implementation

The legacy single-boss live handler now persists its already-calculated terminal settlement atomically: complete player snapshots, a terminal dungeon run envelope, and pending result outbox events share one WAL transaction. The envelope is not exposed as an active run, and this does not implement resumable active encounters.

Still outstanding: atomic durable entry/attempt charging, per-round progress commits, active-run restart resume, spectator/death transitions, resurrection commands, leader AFK timeout/disband, and the future multi-step catacomb room content. Existing combat and reward formulas remain unchanged by the settlement integration.
## 2026-11-28 — immutable resumable execution preparation

- Added `server/src/dungeonRunExecutionPreparation.ts` as a pure boundary that binds the already-calculated immutable `PreparedDungeonEncounter` to an active run and derives a deterministic per-round schedule from its frozen combat result.
- The round schedule preserves the exact aggregate outgoing damage and each participant's incoming damage using cumulative integer splits; it does not rerun combat math, RNG, healing, reward calculation, or loot allocation.
- The prepared terminal player snapshots, reports, request bindings, drop recipients, and outbox payload remain frozen while the run's current participant HP and round cursor advance.
- Corrected run-store validation: prepared `hpBefore` is the immutable entry HP, not the participant's mutable current HP after later rounds. Validation now checks entry/final HP against the participant's frozen maximum and continues to validate snapshot ownership. The attachment boundary still checks that `hpBefore` exactly matches the current entry HP when the preparation is first attached.
- Tests cover plan conservation, JSON recovery after a committed round, preservation of frozen terminal snapshots, idempotent preparation, conflicting/stale snapshots, terminal/missing runs, and compatibility with the existing atomic attempt-charge preparation.
- This remains a pure preparation layer. Production `runExpeditionDungeon()` is not yet wired to active entry or round actions; no active run is exposed to clients by this commit.
- Next: use this prepared execution as the input to one atomic entry transaction that charges attempts/battle counters and writes the active run together. Then add authenticated round-advance/resume actions and atomic per-round player/run commits before replacing the one-shot handler. Do not retain parallel legacy combat execution after the new path is enabled.


## 2026-11-28 — атомарный WAL commit подготовленного активного забега

- CI подтверждён пользователем как успешный на предыдущем HEAD `6c4461c369a4564528c864efce0a993643040ffe`: оба workflow завершились с `success`. Изменения этого этапа новее и ожидают отдельной проверки.
- Расширен `server/src/dungeonRunStartRuntime.ts`: если передан уже рассчитанный immutable `PreparedDungeonEncounter`, runtime сначала готовит списание дневных попыток и счётчиков боёв через `prepareDungeonRunStart()`, затем прикрепляет encounter и детерминированный round plan через `prepareDungeonRunExecution()`. Обе части попадают в один `transactWithRecovery()` и один shared-WAL commit файлов `players.json` + `dungeon_runs.json`.
- В активный run сохраняются замороженный roster, полный prepared encounter, round plan и курсор следующего раунда. В player snapshots сохраняются дневная попытка и battle counter; HP и награды будущих раундов не применяются при входе.
- Повтор того же request/run и того же prepared snapshot идемпотентен и не списывает попытку повторно. Конфликтующий prepared snapshot отклоняется. Если recovery обнаружил WAL replay, устаревшие входные snapshots отклоняются до записи.
- Добавлен `server/test/dungeonRunStartExecutionRuntime.test.ts`: атомарное сохранение encounter/round plan/attempt/battle counters, сохранение исходного HP при входе, idempotent retry, конфликт snapshot и recovery после прерывания записи players target. Тест зарегистрирован в `server/package.json`.
- Статически перечитаны runtime, новый test, package script и существующие WAL/start helpers после записи. Ассистент не запускал тесты и CI.
- Важная граница: production `runExpeditionDungeon()` пока не вызывает этот prepared-entry runtime; live handler остаётся синхронным legacy one-shot и сразу завершает encounter. Этот этап готовит и проверяет атомарную транзакцию, но ещё не включает player-facing resumable run.
- Следующий этап: заменить production one-shot entry на подготовленный active-run commit; добавить authenticated resume/advance action и атомарное сохранение каждого раунда через `commitDungeonRunRound()`. Финальные rewards/player snapshots/outbox должны применяться только на terminal commit. Не сохранять старый one-shot runtime как параллельный fallback.


## 2026-11-28 — live resumable integration: обязательная preparation boundary

The exact current production boundary was rechecked after CI passed on PR #39 HEAD `a2eff43f4d9b0ec6fa454c166726cbc589ce28ad` (Server checks run `46175433765` and Quality Gate run `46175433755`, both success).

The current `Room.runExpeditionDungeon()` is still a synchronous one-shot path. It mutates live Player instances while resolving the encounter, charges daily attempts, applies HP and rewards, allocates loot, updates quest/history/report/outbox data, and only then creates a prepared terminal settlement and commits it atomically. The prepared active-run start and round runtimes are not called by this handler.

Do not insert an active-run start transaction in front of this handler: the handler already performs mutations and random rolls, so a retry or crash between start and settlement can double-charge attempts or leave a durable active run without matching settlement.

Required next implementation slice:
1. Extract the complete encounter preparation to operate on detached Player snapshots. It must not mutate ONLINE_PLAYERS or persist state.
2. Preserve exact combat formulas, RNG call order, loot roll/recipient allocation order, XP/gold/healing calculations, counters, activity timestamps, reports, quest updates and outbox payloads. No balance changes.
3. Produce one immutable PreparedDungeonEncounter containing all terminal settlement snapshots and random outcomes before the entry transaction.
4. Commit daily attempt/battle counters, active run, prepared encounter and player snapshots together through the shared WAL.
5. Add authenticated resume/advance actions and per-round commits. Only terminal finalization applies prepared rewards/player snapshots and queues result outbox events.
6. Remove the old one-shot path when the new flow is complete; do not retain parallel legacy combat fallback.

This is an integration safety boundary, not a claim that resumable gameplay is already live.
