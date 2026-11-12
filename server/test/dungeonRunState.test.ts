import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceDungeonRunRound,
  createDungeonRunRecord,
  finishDungeonRun,
  validateDungeonRunStore,
} from '../src/dungeonRunState.js';

function run() {
  return createDungeonRunRecord({
    runId: 'run_001', requestId: 'dungeon_req_001', dungeonId: 'fl_dungeon_03',
    groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 120 },
      { playerId: 'p2', health: 90, maxHealth: 110 },
    ],
    bossId: 'boss_03', bossHealth: 500, seed: 'deterministic-seed', now: 1000,
  });
}

test('durable dungeon run freezes the party roster and captures independent participant state', () => {
  const state = run();
  assert.deepEqual(state.participantIds, ['p1', 'p2']);
  assert.equal(state.leaderId, 'p1');
  assert.equal(state.participants.p1.health, 100);
  assert.equal(state.participants.p2.health, 90);
  assert.equal(state.status, 'active');
  assert.equal(validateDungeonRunStore({ run_001: state }).run_001.requestId, 'dungeon_req_001');
});

test('a saved round restores its exact HP, boss HP, round index and activity snapshot', () => {
  const afterRound = advanceDungeonRunRound(run(), {
    now: 2000, bossHealth: 320, participantHealth: { p1: 75, p2: 62 },
  });
  const restored = validateDungeonRunStore(JSON.parse(JSON.stringify({ run_001: afterRound }))).run_001;
  assert.equal(restored.roundIndex, 1);
  assert.equal(restored.encounter.bossHealth, 320);
  assert.equal(restored.participants.p1.health, 75);
  assert.equal(restored.participants.p2.health, 62);
  assert.equal(restored.updatedAt, 2000);
});

test('terminal result is durable and duplicate same-result completion is idempotent', () => {
  const completed = finishDungeonRun(run(), 'win', 3000);
  assert.equal(finishDungeonRun(completed, 'win', 4000), completed);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.terminalResult?.requestId, 'dungeon_req_001');
  assert.throws(() => finishDungeonRun(completed, 'loss', 4000), /different terminal result/);
});

test('invalid roster, leader and terminal snapshots fail closed on startup recovery', () => {
  const state = run();
  assert.throws(() => validateDungeonRunStore({
    run_001: { ...state, participantIds: ['p2'] },
  }), /invalid run record/);
  assert.throws(() => validateDungeonRunStore({
    run_001: { ...finishDungeonRun(state, 'win', 3000), terminalResult: undefined },
  }), /terminal run without a durable terminal result/);
});
