import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreparedDungeonEncounter } from '../src/dungeonEncounterPreparation.js';
import { commitPreparedDungeonEncounter } from '../src/dungeonEncounterCommitRuntime.js';
import {
  commitCommittedDungeonEncounterFinalization,
  prepareCommittedDungeonEncounterFinalization,
} from '../src/dungeonPreparedEncounterFinalizationRuntime.js';
import { createDungeonRunRecord, type DungeonRunStore } from '../src/dungeonRunState.js';

function fixture(win = true) {
  const base = createDungeonRunRecord({
    runId: 'run_frozen', requestId: 'req_frozen', dungeonId: 'dungeon_frozen',
    groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 100 },
      { playerId: 'p2', health: 90, maxHealth: 100 },
    ],
    bossId: 'boss_frozen', bossHealth: 500, seed: 'seed_frozen', now: 100,
  });
  const encounter = createPreparedDungeonEncounter({
    version: 1, runId: 'run_frozen', requestId: 'req_frozen', dungeonId: 'dungeon_frozen',
    bossId: 'boss_frozen', preparedAt: 150, participantIds: ['p1', 'p2'],
    combat: { rounds: 2, incoming: [10, 20], win, damageByParticipant: [50, 40] },
    drops: win ? [{ itemId: 'trophy_1', recipientId: 'p2' }] : [],
    participants: {
      p1: { playerId: 'p1', hpBefore: 100, hpAfter: 95, incomingDamage: 10, outgoingDamage: 50,
        xp: win ? 100 : 0, gold: win ? 20 : 0, lootIds: [], report: { rounds: 2 }, resultText: win ? 'Victory' : 'Defeat' },
      p2: { playerId: 'p2', hpBefore: 90, hpAfter: 80, incomingDamage: 20, outgoingDamage: 40,
        xp: win ? 100 : 0, gold: win ? 20 : 0, lootIds: win ? ['trophy_1'] : [], report: { rounds: 2 }, resultText: win ? 'Victory' : 'Defeat' },
    },
    playerSnapshots: {
      p1: { id: 'p1', health: 95, gold: win ? 120 : 100, inventory: '[]' },
      p2: { id: 'p2', health: 80, gold: win ? 220 : 200, inventory: win ? '[{"id":"trophy_1"}]' : '[]' },
    },
  });
  const attached = commitPreparedDungeonEncounter({
    runtime: { transact<T>(prepare: (recovered: boolean) => { files: { players: Record<string, Record<string, unknown>>; dungeonRuns: DungeonRunStore }; result: T; skipWrite?: boolean }): T {
      return prepare(false).result;
    }},
    runId: base.runId,
    runs: { [base.runId]: base },
    players: { p1: {}, p2: {} },
    encounter,
  });
  return { runs: attached.runs, encounter };
}

test('finalization derives exact outcome and player snapshots from the committed encounter', () => {
  const { runs } = fixture(true);
  const result = prepareCommittedDungeonEncounterFinalization({ runId: 'run_frozen', runs, now: 200 });
  assert.equal(result.run.status, 'completed');
  assert.equal(result.run.terminalResult?.outcome, 'win');
  assert.equal(result.players.p1.gold, 120);
  assert.equal(result.players.p2.gold, 220);
  assert.deepEqual(result.players.p2.inventory, '[{"id":"trophy_1"}]');
  assert.equal(result.encounter.combat.win, true);
});

test('a losing encounter cannot persist victory drops', () => {
  const { encounter } = fixture(true);
  const invalid = JSON.parse(JSON.stringify(encounter));
  invalid.combat.win = false;
  assert.throws(() => createPreparedDungeonEncounter(invalid), /cannot contain victory drops/);
});

test('loss finalization uses frozen loss snapshots and cannot be changed to a win by caller input', () => {
  const { runs } = fixture(false);
  const result = prepareCommittedDungeonEncounterFinalization({ runId: 'run_frozen', runs, now: 200 });
  assert.equal(result.run.terminalResult?.outcome, 'loss');
  assert.equal(result.players.p1.gold, 100);
  assert.equal(result.players.p2.gold, 200);
});

test('finalization refuses runs without a committed encounter and rejects unresolved rounds', () => {
  const { runs } = fixture(true);
  const withoutEncounter = { run_frozen: { ...runs.run_frozen, preparedEncounter: undefined } };
  assert.throws(() => prepareCommittedDungeonEncounterFinalization({
    runId: 'run_frozen', runs: withoutEncounter, now: 200,
  }), /no committed prepared encounter/);
  const unfinished = { run_frozen: { ...runs.run_frozen, roundPlan: {
    totalRounds: 2, nextRoundIndex: 1, bossDamageByRound: [250, 250],
    incomingDamageByRound: { p1: [5, 5], p2: [10, 10] },
  }, roundIndex: 1 } };
  assert.throws(() => prepareCommittedDungeonEncounterFinalization({
    runId: 'run_frozen', runs: unfinished, now: 200,
  }), /unresolved/);
});

test('WAL finalization commits frozen snapshots and terminal marker exactly once', () => {
  let saved: { players?: Record<string, Record<string, unknown>>; dungeonRuns?: DungeonRunStore; dungeonOutbox?: unknown } | undefined;
  let writes = 0;
  const runtime = { transact<T>(prepare: (recovered: boolean) => {
    files: { players?: Record<string, Record<string, unknown>>; dungeonRuns?: DungeonRunStore; dungeonOutbox?: unknown };
    result: T; skipWrite?: boolean;
  }): T {
    const plan = prepare(false);
    if (!plan.skipWrite) { saved = plan.files; writes++; }
    return plan.result;
  }};
  const { runs } = fixture(true);
  const first = commitCommittedDungeonEncounterFinalization({ runtime, runId: 'run_frozen', runs, now: 200 });
  assert.equal(first.alreadyFinalized, false);
  assert.equal(writes, 1);
  assert.equal(saved?.players?.p1.gold, 120);
  const retry = commitCommittedDungeonEncounterFinalization({
    runtime, runId: 'run_frozen', runs: first.runs, now: 300,
  });
  assert.equal(retry.alreadyFinalized, true);
  assert.equal(writes, 1);
});

test('WAL recovery blocks finalization until the caller reloads durable snapshots', () => {
  const { runs } = fixture(true);
  const runtime = { transact<T>(prepare: (recovered: boolean) => {
    files: { players?: Record<string, Record<string, unknown>>; dungeonRuns?: DungeonRunStore; dungeonOutbox?: unknown };
    result: T; skipWrite?: boolean;
  }): T { return prepare(true).result; }};
  assert.throws(() => commitCommittedDungeonEncounterFinalization({
    runtime, runId: 'run_frozen', runs, now: 200,
  }), /recovered during committed encounter finalization/);
});
