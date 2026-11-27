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

test('mineral catalog contains only the four approved raw materials and their approved blanks', () => {
  const expected = [
    ['stone', 'Камень', 'stone_blank', 'Каменная заготовка', 1],
    ['granite', 'Гранит', 'granite_blank', 'Гранитная заготовка', 20],
    ['obsidian', 'Обсидиан', 'obsidian_blank', 'Обсидиановая заготовка', 40],
    ['clay', 'Глина', 'ceramic_blank', 'Керамическая заготовка', 1],
  ] as const;
  for (const [rawId, rawName, blankId, blankName, level] of expected) {
    const raw = RESOURCE_ITEMS.find(item => item.id === rawId);
    const blank = RESOURCE_ITEMS.find(item => item.id === blankId);
    assert.ok(raw, 'missing ' + rawId);
    assert.ok(blank, 'missing ' + blankId);
    assert.equal(raw.name, rawName);
    assert.equal(blank.name, blankName);
    assert.equal(raw.resourceGroup, 'mineral');
    assert.equal(blank.resourceGroup, 'mineral');
    assert.equal(raw.resourceForm, 'raw');
    assert.equal(blank.resourceForm, 'blank');
    assert.equal(raw.level, level);
    assert.equal(blank.level, level);
    assert.equal(raw.price, 0);
    assert.equal(blank.price, 0);
  }
});

test('mineral processing recipes use the approved raw-to-blank pairs', () => {
  const expected = [
    ['process_stone_blank', 'stone', 'stone_blank', 3, 1, 60, 1],
    ['process_granite_blank', 'granite', 'granite_blank', 4, 1, 120, 20],
    ['process_obsidian_blank', 'obsidian', 'obsidian_blank', 3, 1, 180, 40],
    ['process_ceramic_blank', 'clay', 'ceramic_blank', 4, 1, 90, 1],
  ] as const;
  for (const [id, input, output, quantity, count, seconds, level] of expected) {
    const recipe = RESOURCE_RECIPES.find(item => item.id === id);
    assert.ok(recipe, 'missing ' + id);
    assert.deepEqual(recipe.materials, { [input]: quantity });
    assert.equal(recipe.output, output);
    assert.equal(recipe.count, count);
    assert.equal(recipe.seconds, seconds);
    assert.equal(recipe.level, level);
    assert.equal(recipe.workGuild, 'blacksmith');
  }
});
