import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreparedDungeonEncounter } from '../src/dungeonEncounterPreparation.js';
import { createDungeonRunRecord, type DungeonRunRecord } from '../src/dungeonRunState.js';
import { resolveDungeonRequestRecovery } from '../src/dungeonRequestRecovery.js';

function run(): DungeonRunRecord {
  return createDungeonRunRecord({
    runId: 'run_001', requestId: 'dungeon_req_001', dungeonId: 'fl_dungeon_03',
    groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 120 },
      { playerId: 'p2', health: 90, maxHealth: 110 },
    ],
    bossId: 'boss_03', bossHealth: 500, seed: 'seed_001', now: 1000,
  });
}

const identity = {
  requestId: 'dungeon_req_001', dungeonId: 'fl_dungeon_03',
  groupId: 'group_1', leaderId: 'p1', participantIds: ['p1', 'p2'],
};

test('unknown request is routed to a fresh start', () => {
  assert.deepEqual(resolveDungeonRequestRecovery({ identity, runs: {} }), { kind: 'not-found' });
});

test('active run without committed encounter resumes preparation without another entry', () => {
  const result = resolveDungeonRequestRecovery({ identity, runs: { run_001: run() } });
  assert.equal(result.kind, 'prepare-encounter');
  if (result.kind !== 'not-found') assert.equal(result.run.runId, 'run_001');
});

test('active run with committed encounter routes only to finalization', () => {
  const base = run();
  const encounter = createPreparedDungeonEncounter({
    version: 1, runId: base.runId, requestId: base.requestId, dungeonId: base.dungeonId,
    bossId: base.encounter.bossId, preparedAt: 1001, participantIds: ['p1', 'p2'],
    combat: { rounds: 2, incoming: [5, 6], win: true, damageByParticipant: [10, 12] },
    drops: [{ itemId: 'dungeon_resource', recipientId: 'p1' }],
    participants: {
      p1: { playerId: 'p1', hpBefore: 100, hpAfter: 95, incomingDamage: 5, outgoingDamage: 10, xp: 100, gold: 50, lootIds: ['dungeon_resource'], report: {}, resultText: 'win' },
      p2: { playerId: 'p2', hpBefore: 90, hpAfter: 84, incomingDamage: 6, outgoingDamage: 12, xp: 100, gold: 50, lootIds: [], report: {}, resultText: 'win' },
    },
    playerSnapshots: { p1: { health: 95 }, p2: { health: 84 } },
  });
  const preparedRun = { ...base, preparedEncounter: encounter, updatedAt: 1001 };
  const result = resolveDungeonRequestRecovery({ identity, runs: { run_001: preparedRun } });
  assert.equal(result.kind, 'finalize-committed-encounter');
});

test('terminal run routes to saved-result replay, never combat preparation', () => {
  const active = run();
  const terminal: DungeonRunRecord = {
    ...active, status: 'completed',
    terminalResult: {
      outcome: 'win', committedAt: 2000, requestId: active.requestId,
      claimId: 'dungeon:run_001:dungeon_req_001:win',
    },
    updatedAt: 2000,
  };
  const result = resolveDungeonRequestRecovery({ identity, runs: { run_001: terminal } });
  assert.equal(result.kind, 'replay-terminal-result');
});

test('request ID cannot be replayed with a different roster or dungeon', () => {
  assert.throws(() => resolveDungeonRequestRecovery({
    identity: { ...identity, participantIds: ['p1'] }, runs: { run_001: run() },
  }), /different run identity/);
  assert.throws(() => resolveDungeonRequestRecovery({
    identity: { ...identity, dungeonId: 'other_dungeon' }, runs: { run_001: run() },
  }), /different run identity/);
});

test('duplicate durable request IDs are rejected as corrupt routing state', () => {
  const second = { ...run(), runId: 'run_002' };
  assert.throws(() => resolveDungeonRequestRecovery({
    identity, runs: { run_001: run(), run_002: second },
  }), /multiple durable runs/);
});
