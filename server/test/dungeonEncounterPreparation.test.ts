import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPreparedDungeonEncounter,
  validatePreparedDungeonEncounter,
} from '../src/dungeonEncounterPreparation.js';

function fixture() {
  return {
    version: 1 as const,
    runId: 'run_12345678',
    requestId: 'request_123456',
    dungeonId: 'dungeon_30',
    bossId: 'boss_30',
    preparedAt: 1_800_000_000_000,
    participantIds: ['p1', 'p2'],
    combat: {
      rounds: 2,
      incoming: [12, 18],
      win: true,
      damageByParticipant: [75.5, 91.25],
    },
    drops: [
      { itemId: 'ore_rare', recipientId: 'p2' },
      { itemId: 'dungeon_resource', recipientId: 'p1' },
    ],
    participants: {
      p1: {
        playerId: 'p1', hpBefore: 100, hpAfter: 92, incomingDamage: 12,
        outgoingDamage: 75.5, xp: 420, gold: 110,
        lootIds: ['dungeon_resource'], report: { result: 'win', damage: 75 },
        resultText: 'Dungeon cleared.',
      },
      p2: {
        playerId: 'p2', hpBefore: 120, hpAfter: 102, incomingDamage: 18,
        outgoingDamage: 91.25, xp: 420, gold: 110,
        lootIds: ['ore_rare'], report: { result: 'win', damage: 91 },
        resultText: 'Dungeon cleared.',
      },
    },
    playerSnapshots: {
      p1: { health: 92, gold: 110, inventory: '["dungeon_resource"]' },
      p2: { health: 102, gold: 110, inventory: '["ore_rare"]' },
    },
  };
}

test('freezes a prepared legacy settlement and preserves already-rolled loot recipients', () => {
  const source = fixture();
  const prepared = createPreparedDungeonEncounter(source);
  source.drops[0].recipientId = 'p1';
  source.playerSnapshots.p1.health = 1;

  assert.equal(prepared.drops[0].recipientId, 'p2');
  assert.equal(prepared.playerSnapshots.p1.health, 92);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.participants.p1.report), true);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared)), {
    ...fixture(),
    participantIds: ['p1', 'p2'],
  });
});

test('restores and revalidates the exact prepared result after JSON serialization', () => {
  const prepared = createPreparedDungeonEncounter(fixture());
  const restored = validatePreparedDungeonEncounter(JSON.parse(JSON.stringify(prepared)));
  assert.deepEqual(restored, prepared);
  assert.equal(restored.combat.win, true);
  assert.deepEqual(restored.drops, fixture().drops);
});

test('rejects loot recipients that disagree with the per-player settlement', () => {
  const invalid = fixture();
  invalid.participants.p1.lootIds = ['ore_rare'];
  assert.throws(() => createPreparedDungeonEncounter(invalid), /loot allocation does not match/);
});

test('rejects snapshots whose persisted HP differs from prepared settlement HP', () => {
  const invalid = fixture();
  invalid.playerSnapshots.p2.health = 101;
  assert.throws(() => createPreparedDungeonEncounter(invalid), /settlement is invalid/);
});

test('rejects missing participant snapshots and combat arrays with mismatched roster size', () => {
  const missing = fixture();
  delete (missing.playerSnapshots as Record<string, unknown>).p2;
  assert.throws(() => createPreparedDungeonEncounter(missing), /one result and player snapshot/);
  const badCombat = fixture();
  badCombat.combat.incoming.pop();
  assert.throws(() => createPreparedDungeonEncounter(badCombat), /header or combat result/);
});
