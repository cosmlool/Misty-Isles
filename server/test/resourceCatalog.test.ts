import assert from 'node:assert/strict';
import test from 'node:test';
import { RESOURCE_ITEMS, RESOURCE_RECIPES } from '../src/resourceCatalog.js';

test('resource catalog has unique item and recipe identifiers', () => {
  const itemIds = RESOURCE_ITEMS.map(item => item.id);
  const recipeIds = RESOURCE_RECIPES.map(recipe => recipe.id);
  assert.equal(new Set(itemIds).size, itemIds.length);
  assert.equal(new Set(recipeIds).size, recipeIds.length);
});

test('each metal has exactly four direct-from-ingot universal blanks', () => {
  const metals = ['copper', 'iron', 'steel', 'deep_silver', 'astralite'];
  const blankTypes = ['plate', 'rod', 'wire', 'sheet'];
  for (const metal of metals) {
    for (const blank of blankTypes) {
      const itemId = 'metal_' + metal + '_' + blank;
      assert.ok(RESOURCE_ITEMS.some(item => item.id === itemId), 'missing ' + itemId);
      const recipe = RESOURCE_RECIPES.find(entry => entry.id === 'forge_' + metal + '_' + blank);
      assert.ok(recipe, 'missing recipe for ' + itemId);
      assert.deepEqual(Object.keys(recipe.materials), ['ingot_' + metal]);
      assert.equal(recipe.workGuild, 'blacksmith');
      assert.equal(recipe.output, itemId);
    }
  }
});

test('steel is an iron-and-charcoal alloy, not a mined ore', () => {
  assert.ok(!RESOURCE_ITEMS.some(item => item.id === 'ore_steel'));
  const recipe = RESOURCE_RECIPES.find(entry => entry.id === 'smelt_steel_ingot');
  assert.ok(recipe);
  assert.deepEqual(recipe.materials, { ingot_iron: 2, charcoal: 1 });
  assert.equal(recipe.output, 'ingot_steel');
  assert.equal(recipe.count, 2);
});

test('rare metals fill the two approved progression positions without adding a third', () => {
  const metalIngots = RESOURCE_ITEMS.filter(item => item.resourceGroup === 'metal' && item.resourceForm === 'ingot');
  assert.deepEqual(metalIngots.map(item => item.id), ['ingot_copper', 'ingot_iron', 'ingot_steel', 'ingot_deep_silver', 'ingot_astralite']);
  assert.ok(RESOURCE_ITEMS.some(item => item.id === 'ore_deep_silver'));
  assert.ok(RESOURCE_ITEMS.some(item => item.id === 'star_core_fragment'));
});

test('resource recipes only consume catalog resources and produce catalog resources', () => {
  const ids = new Set(RESOURCE_ITEMS.map(item => item.id));
  for (const recipe of RESOURCE_RECIPES) {
    assert.ok(ids.has(recipe.output), 'unknown output in ' + recipe.id);
    for (const id of Object.keys(recipe.materials)) assert.ok(ids.has(id), 'unknown input ' + id + ' in ' + recipe.id);
    assert.ok(Number.isSafeInteger(recipe.seconds) && recipe.seconds > 0);
    assert.ok(Number.isSafeInteger(recipe.level) && recipe.level >= 1);
    assert.ok(Number.isSafeInteger(recipe.count) && recipe.count >= 1);
  }
});
