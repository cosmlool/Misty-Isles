import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreparedDungeonEncounter, validatePreparedDungeonEncounter } from '../src/dungeonEncounterPreparation.js';
import { commitPreparedDungeonEncounter, prepareDungeonEncounterCommit } from '../src/dungeonEncounterCommitRuntime.js';
import { createDungeonRunRecord, validateDungeonRunStore } from '../src/dungeonRunState.js';

function runStore() {
  const run = createDungeonRunRecord({
    runId: 'run_1', requestId: 'req_1', dungeonId: 'dungeon_1', groupId: 'group_1',
    leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 100 },
      { playerId: 'p2', health: 90, maxHealth: 100 },
    ],
    bossId: 'boss_1', bossHealth: 500, seed: 'seed_1', now: 100,
  });
  return { run_1: run };
}

function encounter() {
  return createPreparedDungeonEncounter({
    version: 1, runId: 'run_1', requestId: 'req_1', dungeonId: 'dungeon_1',
    bossId: 'boss_1', preparedAt: 150, participantIds: ['p1', 'p2'],
    combat: { rounds: 2, incoming: [10, 20], win: true, damageByParticipant: [50, 40] },
    drops: [{ itemId: 'trophy_1', recipientId: 'p2' }],
    participants: {
      p1: { playerId: 'p1', hpBefore: 100, hpAfter: 95, incomingDamage: 10, outgoingDamage: 50,
        xp: 100, gold: 20, lootIds: [], report: { rounds: 2 }, resultText: 'Victory' },
      p2: { playerId: 'p2', hpBefore: 90, hpAfter: 80, incomingDamage: 20, outgoingDamage: 40,
        xp: 100, gold: 20, lootIds: ['trophy_1'], report: { rounds: 2 }, resultText: 'Victory' },
    },
    playerSnapshots: { p1: { id: 'p1', health: 95 }, p2: { id: 'p2', health: 80 } },
  });
}

test('prepared encounter is attached to the matching durable run and survives JSON restore', () => {
  const prepared = prepareDungeonEncounterCommit({ runId: 'run_1', runs: runStore(), encounter: encounter() });
  assert.equal(prepared.alreadyPrepared, false);
  const restored = validateDungeonRunStore(JSON.parse(JSON.stringify(prepared.runs)));
  assert.deepEqual(validatePreparedDungeonEncounter(restored.run_1.preparedEncounter), encounter());
});

test('same prepared encounter retry is idempotent; conflicting retry is rejected', () => {
  const first = prepareDungeonEncounterCommit({ runId: 'run_1', runs: runStore(), encounter: encounter() });
  const retry = prepareDungeonEncounterCommit({ runId: 'run_1', runs: first.runs, encounter: encounter() });
  assert.equal(retry.alreadyPrepared, true);
  const changed = JSON.parse(JSON.stringify(encounter()));
  changed.participants.p1.gold = 21;
  assert.throws(() => prepareDungeonEncounterCommit({
    runId: 'run_1', runs: first.runs, encounter: createPreparedDungeonEncounter(changed),
  }), /different prepared encounter/);
});

test('prepared encounter cannot be attached to another run, roster, boss, or terminal run', () => {
  const wrongRun = { ...runStore(), run_2: { ...runStore().run_1, runId: 'run_2' } };
  assert.throws(() => prepareDungeonEncounterCommit({
    runId: 'run_2', runs: wrongRun, encounter: encounter(),
  }), /identity does not match/);
  const terminal = { run_1: { ...runStore().run_1, status: 'completed' as const,
    terminalResult: { outcome: 'win' as const, committedAt: 120, requestId: 'req_1' } } };
  assert.throws(() => prepareDungeonEncounterCommit({
    runId: 'run_1', runs: terminal, encounter: encounter(),
  }), /terminal dungeon run/);
});

test('WAL recovery requires reloading snapshots and does not write stale encounter data', () => {
  let writes = 0;
  const runtime = { transact<T>(prepare: (recovered: boolean) => {
    files: { players: Record<string, Record<string, unknown>>; dungeonRuns: ReturnType<typeof runStore> };
    result: T; skipWrite?: boolean;
  }): T {
    const plan = prepare(true);
    if (!plan.skipWrite) writes++;
    return plan.result;
  }};
  assert.throws(() => commitPreparedDungeonEncounter({
    runtime, runId: 'run_1', runs: runStore(), players: { p1: { health: 100 }, p2: { health: 90 } },
    encounter: encounter(),
  }), /recovered during encounter preparation/);
  assert.equal(writes, 0);
});
