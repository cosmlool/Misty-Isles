import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateDungeonDropRecipients, rollDungeonDropIds } from '../src/dungeonDropPreparation.js';

test('rolls guaranteed and optional dungeon drops in source order with injected RNG', () => {
  const rolls = [0.1, 0.99, 0.2];
  let calls = 0;
  const drops = rollDungeonDropIds('guaranteed', [
    { id: 'first', chance: 0.5 },
    { id: 'guaranteed', chance: 1 },
    { id: 'second', chance: 0.5 },
    { id: 'third', chance: 0.5 },
  ], 0, () => { calls += 1; return rolls.shift()!; });
  assert.deepEqual(drops, ['guaranteed', 'first', 'third']);
  assert.equal(calls, 3);
});

test('caps optional drop chance at 95 percent without changing guaranteed drops', () => {
  const drops = rollDungeonDropIds('base', [{ id: 'rare', chance: 10 }], 0, () => 0.949);
  assert.deepEqual(drops, ['base', 'rare']);
  assert.deepEqual(rollDungeonDropIds('base', [{ id: 'rare', chance: 10 }], 0, () => 0.95), ['base']);
});

test('allocates each rolled item once and preserves recipient selection order', () => {
  const indices = [1, 0, 1];
  const allocations = allocateDungeonDropRecipients(['base', 'rare', 'common'], ['p1', 'p2'], () => indices.shift()!);
  assert.deepEqual(allocations, [
    { itemId: 'base', recipientId: 'p2' },
    { itemId: 'rare', recipientId: 'p1' },
    { itemId: 'common', recipientId: 'p2' },
  ]);
});

test('rejects invalid recipient indices and duplicate participant IDs', () => {
  assert.throws(() => allocateDungeonDropRecipients(['base'], ['p1'], () => 1), /outside the participant roster/);
  assert.throws(() => allocateDungeonDropRecipients(['base'], ['p1', 'p1'], () => 0), /Invalid dungeon drop recipient/);
});
