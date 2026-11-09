import assert from 'node:assert/strict';
import test from 'node:test';
import { isLastEquippedCopy, removeInventoryCopy } from '../src/inventoryOperations.js';

test('removing one duplicate keeps the remaining equipped copy equipped', () => {
  const inventory = ['iron_sword', 'iron_sword', 'herb_material'];
  const equipment = { weapon: 'iron_sword', armor: '' };
  const result = removeInventoryCopy(inventory, equipment, 0);
  assert.equal(result.itemId, 'iron_sword');
  assert.deepEqual(result.inventory, ['iron_sword', 'herb_material']);
  assert.deepEqual(result.equipment, equipment);
  assert.equal(isLastEquippedCopy(result.inventory, result.equipment, 'iron_sword'), true);
  assert.deepEqual(inventory, ['iron_sword', 'iron_sword', 'herb_material']);
  assert.deepEqual(equipment, { weapon: 'iron_sword', armor: '' });
});

test('removing the final copy clears its equipment slot', () => {
  const result = removeInventoryCopy(['iron_sword', 'herb_material'], { weapon: 'iron_sword' }, 0);
  assert.deepEqual(result.inventory, ['herb_material']);
  assert.deepEqual(result.equipment, { weapon: '' });
  assert.equal(isLastEquippedCopy(['iron_sword'], { weapon: 'iron_sword' }, 'iron_sword'), true);
});

test('removing an unequipped item leaves unrelated equipment unchanged', () => {
  const result = removeInventoryCopy(['herb_material', 'iron_sword'], { weapon: 'iron_sword' }, 0);
  assert.deepEqual(result.inventory, ['iron_sword']);
  assert.deepEqual(result.equipment, { weapon: 'iron_sword' });
  assert.equal(isLastEquippedCopy(result.inventory, result.equipment, 'herb_material'), false);
});

test('invalid inventory indices are rejected without mutating input', () => {
  const inventory = ['iron_sword'];
  const equipment = { weapon: 'iron_sword' };
  assert.throws(() => removeInventoryCopy(inventory, equipment, 1), /not in the inventory/);
  assert.deepEqual(inventory, ['iron_sword']);
  assert.deepEqual(equipment, { weapon: 'iron_sword' });
});
