import assert from 'node:assert/strict';
import test from 'node:test';
import { refundCraftMaterials } from '../src/craftingQueue.js';

test('refunds the exact materials stored on a craft job', () => {
  const inventory = ['herb_material', 'wood_material'];
  const result = refundCraftMaterials(inventory, { materials: { crystal_shard: 2, ash_ore: 1 } });
  assert.equal(result.refunded, true);
  assert.deepEqual(result.inventory, ['herb_material', 'wood_material', 'crystal_shard', 'crystal_shard', 'ash_ore']);
  assert.deepEqual(inventory, ['herb_material', 'wood_material']);
});

test('uses the current recipe as a fallback for older queued jobs', () => {
  const result = refundCraftMaterials(['wood_material'], {}, { wood_material: 3, rune_shard: 1 });
  assert.equal(result.refunded, true);
  assert.deepEqual(result.inventory, ['wood_material', 'wood_material', 'wood_material', 'wood_material', 'rune_shard']);
});

test('refuses to invent a refund when neither job nor recipe has valid materials', () => {
  const inventory = ['ash_ore'];
  const result = refundCraftMaterials(inventory, { materials: { ash_ore: -5 } });
  assert.equal(result.refunded, false);
  assert.deepEqual(result.inventory, inventory);
});

test('rejects malformed material quantities and oversized refunds', () => {
  assert.equal(refundCraftMaterials([], { materials: { ash_ore: 1001 } }).refunded, false);
  assert.equal(refundCraftMaterials([], { materials: ['ash_ore'] }).refunded, false);
});
