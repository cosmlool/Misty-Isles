import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAvailableUniqueItems, isLastEquippedCopy, ownsItemCopy, removeInventoryCopy, validateInventoryStackAction } from '../src/inventoryOperations.js';

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

test('item-type properties remain while another copy is still owned', () => {
  assert.equal(ownsItemCopy(['iron_sword'], { weapon: 'iron_sword' }, 'iron_sword'), true);
  assert.equal(ownsItemCopy([], { weapon: 'iron_sword' }, 'iron_sword'), true);
  assert.equal(ownsItemCopy(['herb_material'], { weapon: '' }, 'iron_sword'), false);
});

test('random reward pools exclude unique items already owned or equipped', () => {
  const pool = ['amulet_power', 'amulet_guard', 'tempered_sword', 'mystery_chest'];
  const unique = new Set(['amulet_power', 'amulet_guard']);
  const available = filterAvailableUniqueItems(pool, unique, ['amulet_power'], { amulet: 'amulet_guard' });
  assert.deepEqual(available, ['tempered_sword', 'mystery_chest']);
});


test('inventory stack action requires the exact item, index and displayed stack count', () => {
  const inventory = ['mystery_chest', 'mystery_chest', 'health_potion'];
  assert.equal(validateInventoryStackAction(inventory, 0, 'mystery_chest', 2), true);
  assert.equal(validateInventoryStackAction(inventory, 0, undefined, 2), false);
  assert.equal(validateInventoryStackAction(inventory, 0, 'mystery_chest', undefined), false);
  assert.equal(validateInventoryStackAction(inventory, 0, 'health_potion', 2), false);
  assert.equal(validateInventoryStackAction(inventory, 0, 'mystery_chest', 1), false);
  assert.equal(validateInventoryStackAction(inventory, 3, 'mystery_chest', 2), false);
  assert.deepEqual(inventory, ['mystery_chest', 'mystery_chest', 'health_potion']);
});

test('replaying a consumed inventory index cannot consume an adjacent duplicate', () => {
  const inventory = ['mystery_chest', 'mystery_chest'];
  assert.equal(validateInventoryStackAction(inventory, 0, 'mystery_chest', 2), true);
  inventory.splice(0, 1);
  // The second request carries the original stack count and is rejected.
  assert.equal(validateInventoryStackAction(inventory, 0, 'mystery_chest', 2), false);
  assert.deepEqual(inventory, ['mystery_chest']);
});

test('inventory stack action rejects unsafe or fractional snapshot counts', () => {
  const inventory = ['mystery_chest'];
  assert.equal(validateInventoryStackAction(inventory, 0, 'mystery_chest', 1.5), false);
  assert.equal(validateInventoryStackAction(inventory, 0, 'mystery_chest', Number.MAX_SAFE_INTEGER + 1), false);
  assert.equal(validateInventoryStackAction(inventory, -1, 'mystery_chest', 1), false);
});
