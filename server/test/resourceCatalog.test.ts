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


test('metal plates use two matching ingots, produce one plate, and never consume crystals', () => {
  const expected = [
    ['copper', 1, 90],
    ['iron', 10, 108],
    ['steel', 20, 128],
    ['deep_silver', 40, 168],
    ['astralite', 60, 208],
  ] as const;
  for (const [metal, level, seconds] of expected) {
    const recipe = RESOURCE_RECIPES.find(item => item.id === 'forge_' + metal + '_plate');
    assert.ok(recipe, 'missing plate recipe for ' + metal);
    assert.deepEqual(recipe.materials, { ['ingot_' + metal]: 2 });
    assert.equal(recipe.output, 'metal_' + metal + '_plate');
    assert.equal(recipe.count, 1);
    assert.equal(recipe.level, level);
    assert.equal(recipe.seconds, seconds);
    assert.equal(recipe.workGuild, 'blacksmith');
    assert.ok(!Object.keys(recipe.materials).some(id => id.includes('crystal')));
  }
});


test('metal rods use one matching ingot, produce one rod, and follow metal progression times', () => {
  const expected = [
    ['copper', 1, 60],
    ['iron', 10, 78],
    ['steel', 20, 98],
    ['deep_silver', 40, 138],
    ['astralite', 60, 178],
  ] as const;
  for (const [metal, level, seconds] of expected) {
    const recipe = RESOURCE_RECIPES.find(item => item.id === 'forge_' + metal + '_rod');
    assert.ok(recipe, 'missing rod recipe for ' + metal);
    assert.deepEqual(recipe.materials, { ['ingot_' + metal]: 1 });
    assert.equal(recipe.output, 'metal_' + metal + '_rod');
    assert.equal(recipe.count, 1);
    assert.equal(recipe.level, level);
    assert.equal(recipe.seconds, seconds);
    assert.equal(recipe.workGuild, 'blacksmith');
  }
});


test('metal wires use one matching ingot, produce two wires, and follow metal progression times', () => {
  const expected = [
    ['copper', 1, 120],
    ['iron', 10, 138],
    ['steel', 20, 158],
    ['deep_silver', 40, 198],
    ['astralite', 60, 238],
  ] as const;
  for (const [metal, level, seconds] of expected) {
    const recipe = RESOURCE_RECIPES.find(item => item.id === 'forge_' + metal + '_wire');
    assert.ok(recipe, 'missing wire recipe for ' + metal);
    assert.deepEqual(recipe.materials, { ['ingot_' + metal]: 1 });
    assert.equal(recipe.output, 'metal_' + metal + '_wire');
    assert.equal(recipe.count, 2);
    assert.equal(recipe.level, level);
    assert.equal(recipe.seconds, seconds);
    assert.equal(recipe.workGuild, 'blacksmith');
  }
});


test('metal sheets use three matching ingots, produce one sheet, and follow metal progression times', () => {
  const expected = [
    ['copper', 1, 150],
    ['iron', 10, 168],
    ['steel', 20, 188],
    ['deep_silver', 40, 228],
    ['astralite', 60, 268],
  ] as const;
  for (const [metal, level, seconds] of expected) {
    const recipe = RESOURCE_RECIPES.find(item => item.id === 'forge_' + metal + '_sheet');
    assert.ok(recipe, 'missing sheet recipe for ' + metal);
    assert.deepEqual(recipe.materials, { ['ingot_' + metal]: 3 });
    assert.equal(recipe.output, 'metal_' + metal + '_sheet');
    assert.equal(recipe.count, 1);
    assert.equal(recipe.level, level);
    assert.equal(recipe.seconds, seconds);
    assert.equal(recipe.workGuild, 'blacksmith');
  }
});


test('textile catalog contains only the approved fiber, wool, thread and fabric materials', () => {
  const expected = [
    ['plant_fiber', 'Растительное волокно', 'raw'],
    ['wool', 'Шерсть', 'raw'],
    ['thread', 'Нить', 'processed'],
    ['fabric', 'Ткань', 'processed'],
  ] as const;
  for (const [id, name, form] of expected) {
    const item = RESOURCE_ITEMS.find(entry => entry.id === id);
    assert.ok(item, 'missing ' + id);
    assert.equal(item.name, name);
    assert.equal(item.resourceGroup, 'textile');
    assert.equal(item.resourceForm, form);
    assert.equal(item.price, 0);
  }
  assert.equal(RESOURCE_ITEMS.filter(item => item.resourceGroup === 'textile').length, 4);
});

test('textile recipes converge both approved raw materials into one thread and one fabric type', () => {
  const expected = [
    ['spin_plant_fiber_thread', { plant_fiber: 3 }, 'thread', 1, 60],
    ['spin_wool_thread', { wool: 3 }, 'thread', 1, 60],
    ['weave_fabric', { thread: 3 }, 'fabric', 1, 90],
  ] as const;
  for (const [id, materials, output, count, seconds] of expected) {
    const recipe = RESOURCE_RECIPES.find(entry => entry.id === id);
    assert.ok(recipe, 'missing ' + id);
    assert.deepEqual(recipe.materials, materials);
    assert.equal(recipe.output, output);
    assert.equal(recipe.count, count);
    assert.equal(recipe.level, 1);
    assert.equal(recipe.seconds, seconds);
    assert.equal(recipe.workGuild, 'blacksmith');
  }
});
