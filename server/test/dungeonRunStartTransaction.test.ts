import assert from 'node:assert/strict';
import test from 'node:test';
import { createDungeonRunRecord } from '../src/dungeonRunState.js';
import { prepareDungeonRunStart } from '../src/dungeonRunStartTransaction.js';

function createRun(requestId = 'dungeon_req_001', runId = 'run_001') {
  return createDungeonRunRecord({
    runId, requestId, dungeonId: 'fl_dungeon_03', groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 120 },
      { playerId: 'p2', health: 90, maxHealth: 110 },
    ],
    bossId: 'boss_03', bossHealth: 500, seed: 'seed_001', now: 1000,
  });
}

function players() {
  return {
    p1: { id: 'p1', quests: JSON.stringify({ dungeonDay: '2026-11-11', dungeonRuns: 2, marker: 'keep' }), battles: 4 },
    p2: { id: 'p2', quests: JSON.stringify({ dungeonDay: '2026-11-12', dungeonRuns: 1 }), battles: 8 },
  };
}

test('dungeon entry freezes run and charges each participant exactly once', () => {
  const prepared = prepareDungeonRunStart({
    run: createRun(), players: players(), runs: {}, day: '2026-11-12',
  });
  assert.equal(prepared.alreadyStarted, false);
  assert.equal(prepared.runs.run_001.status, 'active');
  assert.equal(JSON.parse(prepared.players.p1.quests).dungeonRuns, 1);
  assert.equal(JSON.parse(prepared.players.p1.quests).marker, 'keep');
  assert.equal(JSON.parse(prepared.players.p2.quests).dungeonRuns, 2);
  assert.equal(prepared.players.p1.battles, 5);
  assert.equal(prepared.players.p2.battles, 9);
});

test('retrying the same request is idempotent and does not charge another attempt', () => {
  const first = prepareDungeonRunStart({
    run: createRun(), players: players(), runs: {}, day: '2026-11-12',
  });
  const retry = prepareDungeonRunStart({
    run: createRun(), players: first.players, runs: first.runs, day: '2026-11-12',
  });
  assert.equal(retry.alreadyStarted, true);
  assert.equal(JSON.parse(retry.players.p1.quests).dungeonRuns, 1);
  assert.equal(retry.players.p1.battles, 5);
});

test('a request ID cannot be reused for a different run', () => {
  const first = prepareDungeonRunStart({
    run: createRun(), players: players(), runs: {}, day: '2026-11-12',
  });
  assert.throws(() => prepareDungeonRunStart({
    run: createRun('dungeon_req_001', 'run_002'),
    players: first.players, runs: first.runs, day: '2026-11-12',
  }), /already bound/);
});

test('active run overlap and exhausted daily attempts reject the whole entry', () => {
  const first = prepareDungeonRunStart({
    run: createRun(), players: players(), runs: {}, day: '2026-11-12',
  });
  assert.throws(() => prepareDungeonRunStart({
    run: createRun('dungeon_req_002', 'run_002'),
    players: first.players, runs: first.runs, day: '2026-11-12',
  }), /already belongs to an active run/);
  const exhausted = players();
  exhausted.p1.quests = JSON.stringify({ dungeonDay: '2026-11-12', dungeonRuns: 3 });
  assert.throws(() => prepareDungeonRunStart({
    run: createRun(), players: exhausted, runs: {}, day: '2026-11-12',
  }), /Daily dungeon attempts exhausted/);
});

test('missing or malformed participant snapshots fail without changing inputs', () => {
  const original = players();
  assert.throws(() => prepareDungeonRunStart({
    run: createRun(), players: { p1: original.p1 }, runs: {}, day: '2026-11-12',
  }), /Every dungeon participant/);
  assert.equal(JSON.parse(original.p1.quests).dungeonRuns, 2);
});
