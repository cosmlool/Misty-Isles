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
- Delivery is at-least-once: a crash between socket send and acknowledgement can replay an event. Client deduplication by `eventId` is still outstanding.
- The dispatcher is wired to player join/reconnect. The live synchronous `runExpeditionDungeon()` handler now writes each participant's `combatResult` event to the outbox in the same shared-WAL transaction as the updated player snapshots, then dispatches pending events and acknowledges them after send. The newer durable dungeon-run round/finalization helpers remain a separate foundation not yet used by the live combat calculation. At-least-once replay still requires client-side deduplication by `eventId`. No reward formula or balance change is included.
