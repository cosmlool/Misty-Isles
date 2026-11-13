import assert from 'node:assert/strict';
import test from 'node:test';
import { createDungeonRunRecord, markDungeonParticipantDead } from '../src/dungeonRunState.js';
import { prepareDungeonRevival } from '../src/dungeonRevivalTransaction.js';
import { RESURRECTION_SCROLL_ID } from '../src/resurrectionScrolls.js';

function createRun() {
  const run = createDungeonRunRecord({
    runId: 'run_atomic', requestId: 'request_atomic_01', dungeonId: 'dungeon_20',
    groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 100 },
      { playerId: 'p2', health: 80, maxHealth: 100 },
    ],
    bossId: 'boss_20', bossHealth: 500, seed: 'seed_1', now: 100,
  });
  return markDungeonParticipantDead(run, 'p2', 150);
}

function playerSnapshots() {
  return {
    p1: { id: 'p1', inventory: JSON.stringify(['moon_dust', RESURRECTION_SCROLL_ID, RESURRECTION_SCROLL_ID]) },
    p2: { id: 'p2', inventory: JSON.stringify(['iron_scrap']) },
  };
}

test('resurrection prepares player inventory and dungeon participant changes together', () => {
  const run = createRun();
  const players = playerSnapshots();
  const prepared = prepareDungeonRevival({
    run, players, rescuerId: 'p1', targetId: 'p2', reviveHealth: 25, now: 200,
  });

  assert.equal(prepared.run.participants.p2.status, 'revived');
  assert.equal(prepared.run.participants.p2.health, 25);
  assert.deepEqual(JSON.parse(prepared.players.p1.inventory), [
    'moon_dust', RESURRECTION_SCROLL_ID,
  ]);
  assert.deepEqual(JSON.parse(prepared.players.p2.inventory), ['iron_scrap']);
  assert.equal(players.p1.inventory, JSON.stringify([
    'moon_dust', RESURRECTION_SCROLL_ID, RESURRECTION_SCROLL_ID,
  ]), 'preparation must not mutate the caller snapshot');
});

test('failed resurrection leaves both supplied snapshots unchanged', () => {
  const run = createRun();
  const players = {
    ...playerSnapshots(),
    p1: { id: 'p1', inventory: JSON.stringify(['moon_dust']) },
  };
  const originalRun = JSON.stringify(run);
  const originalPlayers = JSON.stringify(players);

  assert.throws(() => prepareDungeonRevival({
    run, players, rescuerId: 'p1', targetId: 'p2', reviveHealth: 25, now: 200,
  }), /scroll is required/);
  assert.equal(JSON.stringify(run), originalRun);
  assert.equal(JSON.stringify(players), originalPlayers);
});

test('prepared resurrection survives JSON serialization as a paired snapshot', () => {
  const prepared = prepareDungeonRevival({
    run: createRun(), players: playerSnapshots(),
    rescuerId: 'p1', targetId: 'p2', reviveHealth: 25, now: 200,
  });
  const restored = JSON.parse(JSON.stringify(prepared));
  assert.equal(restored.run.participants.p2.status, 'revived');
  assert.equal(restored.run.participants.p2.health, 25);
  assert.equal(JSON.parse(restored.players.p1.inventory).filter(
    (id: string) => id === RESURRECTION_SCROLL_ID,
  ).length, 1);
});
