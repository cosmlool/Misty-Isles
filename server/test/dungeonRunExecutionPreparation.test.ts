import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreparedDungeonEncounter } from '../src/dungeonEncounterPreparation.js';
import { prepareDungeonRunExecution } from '../src/dungeonRunExecutionPreparation.js';
import { createDungeonRunRecord, resolveNextDungeonRunRound, validateDungeonRunStore } from '../src/dungeonRunState.js';

function runStore() {
  const run = createDungeonRunRecord({
    runId: 'run_execution', requestId: 'request_execution', dungeonId: 'dungeon_20',
    groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 120 },
      { playerId: 'p2', health: 90, maxHealth: 110 },
    ],
    bossId: 'boss_20', bossHealth: 500, seed: 'seed_execution', now: 100,
  });
  return { [run.runId]: run };
}

function encounter() {
  return createPreparedDungeonEncounter({
    version: 1, runId: 'run_execution', requestId: 'request_execution',
    dungeonId: 'dungeon_20', bossId: 'boss_20', preparedAt: 150,
    participantIds: ['p1', 'p2'],
    combat: { rounds: 2, incoming: [10, 20], win: true, damageByParticipant: [50, 40] },
    drops: [],
    participants: {
      p1: { playerId: 'p1', hpBefore: 100, hpAfter: 90, incomingDamage: 10, outgoingDamage: 50,
        xp: 100, gold: 20, lootIds: [], report: { result: 'win' }, resultText: 'Victory' },
      p2: { playerId: 'p2', hpBefore: 90, hpAfter: 70, incomingDamage: 20, outgoingDamage: 40,
        xp: 100, gold: 20, lootIds: [], report: { result: 'win' }, resultText: 'Victory' },
    },
    playerSnapshots: { p1: { id: 'p1', health: 90 }, p2: { id: 'p2', health: 70 } },
  });
}

test('execution preparation freezes exact settlement and derives damage-conserving rounds', () => {
  const prepared = prepareDungeonRunExecution({
    runId: 'run_execution', runs: runStore(), encounter: encounter(),
  });
  assert.equal(prepared.alreadyPrepared, false);
  assert.equal(prepared.run.roundPlan?.totalRounds, 2);
  assert.deepEqual(prepared.run.roundPlan?.bossDamageByRound, [45, 45]);
  assert.deepEqual(prepared.run.roundPlan?.incomingDamageByRound, { p1: [5, 5], p2: [10, 10] });
  assert.equal(prepared.run.preparedEncounter?.participants.p1.xp, 100);
  assert.equal(prepared.run.preparedEncounter?.drops.length, 0);
  assert.deepEqual(validateDungeonRunStore(JSON.parse(JSON.stringify(prepared.runs))), prepared.runs);
});

test('prepared execution remains valid and immutable while committed rounds update live HP', () => {
  const prepared = prepareDungeonRunExecution({
    runId: 'run_execution', runs: runStore(), encounter: encounter(),
  });
  const first = resolveNextDungeonRunRound(prepared.run, 200);
  const restored = validateDungeonRunStore(JSON.parse(JSON.stringify({
    [first.runId]: first,
  }))).run_execution;
  assert.equal(restored.roundIndex, 1);
  assert.equal(restored.participants.p1.health, 95);
  assert.equal(restored.participants.p2.health, 80);
  assert.equal(restored.preparedEncounter?.participants.p1.hpBefore, 100);
  assert.equal(restored.preparedEncounter?.playerSnapshots.p1.health, 90);
  const second = resolveNextDungeonRunRound(restored, 300);
  assert.equal(second.participants.p1.health, 90);
  assert.equal(second.participants.p2.health, 70);
  assert.equal(second.preparedEncounter?.participants.p2.hpAfter, 70);
});

test('execution preparation is idempotent and rejects a conflicting prepared result', () => {
  const first = prepareDungeonRunExecution({
    runId: 'run_execution', runs: runStore(), encounter: encounter(),
  });
  const retry = prepareDungeonRunExecution({
    runId: 'run_execution', runs: first.runs, encounter: encounter(),
  });
  assert.equal(retry.alreadyPrepared, true);
  assert.equal(retry.run, first.run);
  const changed = JSON.parse(JSON.stringify(encounter()));
  changed.participants.p1.gold = 101;
  const changedEncounter = createPreparedDungeonEncounter(changed);
  assert.throws(() => prepareDungeonRunExecution({
    runId: 'run_execution', runs: first.runs, encounter: changedEncounter,
  }), /different or incomplete execution plan/);
});

test('execution preparation rejects entry HP mismatch and terminal or missing runs', () => {
  const changed = JSON.parse(JSON.stringify(encounter()));
  changed.participants.p1.hpBefore = 99;
  const stale = createPreparedDungeonEncounter(changed);
  assert.throws(() => prepareDungeonRunExecution({
    runId: 'run_execution', runs: runStore(), encounter: stale,
  }), /snapshot is stale/);
  const terminal = { run_execution: {
    ...runStore().run_execution, status: 'completed' as const,
    terminalResult: { outcome: 'win' as const, committedAt: 200, requestId: 'request_execution' },
  }};
  assert.throws(() => prepareDungeonRunExecution({
    runId: 'run_execution', runs: terminal, encounter: encounter(),
  }), /terminal dungeon run/);
  assert.throws(() => prepareDungeonRunExecution({
    runId: 'missing', runs: runStore(), encounter: encounter(),
  }), /missing dungeon run/);
});
