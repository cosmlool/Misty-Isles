import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ARMOR_RECIPES } from '../src/armorCatalog.js';
import { RESOURCE_ITEMS, RESOURCE_RECIPES } from '../src/resourceCatalog.js';

const EQUIPMENT_CATALOG = JSON.parse(readFileSync(new URL('../data/equipment_catalog.json', import.meta.url), 'utf8')) as any[];

test('resource catalog has unique item and recipe identifiers', () => {
  const itemIds = RESOURCE_ITEMS.map(item => item.id);
  const recipeIds = RESOURCE_RECIPES.map(recipe => recipe.id);
  assert.equal(new Set(itemIds).size, itemIds.length);
  assert.equal(new Set(recipeIds).size, recipeIds.length);
});

test('resource catalog contains the complete approved 76-ID inventory', () => {
  assert.equal(RESOURCE_ITEMS.length, 76);
  const expectedCounts: Record<string, number> = {
    mineral: 8,
    metal: 29,
    wood: 9,
    organic: 3,
    textile: 4,
    leather: 5,
    beast: 13,
    combined: 4,
    metalworking: 1,
  };
  for (const [group, count] of Object.entries(expectedCounts)) {
    assert.equal(RESOURCE_ITEMS.filter(item => item.resourceGroup === group).length, count, 'unexpected resource count for ' + group);
  }
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


test('leather catalog contains exactly the two approved hides and three shared processed materials', () => {
  const expected = [
    ['hide', 'Шкура', 'raw', 1],
    ['rough_hide', 'Грубая шкура', 'raw', 20],
    ['processed_leather', 'Обработанная кожа', 'processed', 1],
    ['leather_strip', 'Кожаная полоса', 'blank', 1],
    ['leather_blank', 'Кожаная заготовка', 'blank', 1],
  ] as const;
  for (const [id, name, form, level] of expected) {
    const item = RESOURCE_ITEMS.find(entry => entry.id === id);
    assert.ok(item, 'missing ' + id);
    assert.equal(item.name, name);
    assert.equal(item.resourceGroup, 'leather');
    assert.equal(item.resourceForm, form);
    assert.equal(item.level, level);
    assert.equal(item.price, 0);
  }
  assert.equal(RESOURCE_ITEMS.filter(item => item.resourceGroup === 'leather').length, 5);
});

test('both hide types converge into one processed leather and only the two approved leather components', () => {
  const expected = [
    ['tan_hide', { hide: 3 }, 'processed_leather', 1, 1, 90],
    ['tan_rough_hide', { rough_hide: 3 }, 'processed_leather', 1, 20, 150],
    ['cut_leather_strips', { processed_leather: 1 }, 'leather_strip', 2, 1, 60],
    ['prepare_leather_blank', { processed_leather: 2 }, 'leather_blank', 1, 1, 90],
  ] as const;
  for (const [id, materials, output, count, level, seconds] of expected) {
    const recipe = RESOURCE_RECIPES.find(entry => entry.id === id);
    assert.ok(recipe, 'missing ' + id);
    assert.deepEqual(recipe.materials, materials);
    assert.equal(recipe.output, output);
    assert.equal(recipe.count, count);
    assert.equal(recipe.level, level);
    assert.equal(recipe.seconds, seconds);
    assert.equal(recipe.workGuild, 'blacksmith');
  }
  assert.equal(RESOURCE_RECIPES.filter(entry => entry.output === 'processed_leather').length, 2);
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


test('bone and beast catalog contains only the approved bone, claw and fang materials', () => {
  const expected = [
    ['bone', 'Кость', 'raw'],
    ['bone_blank', 'Костяная заготовка', 'processed'],
    ['bone_plate', 'Костяная пластина', 'blank'],
    ['bone_spike', 'Костяной шип', 'blank'],
    ['bone_fragment', 'Костяной фрагмент', 'blank'],
    ['claw', 'Коготь', 'raw'],
    ['processed_claw', 'Обработанный коготь', 'processed'],
    ['claw_element', 'Когтевой элемент', 'blank'],
    ['claw_hook', 'Когтевой крюк', 'blank'],
    ['fang', 'Клык', 'raw'],
    ['sharpened_fang', 'Заточенный клык', 'processed'],
    ['fang_tip', 'Клыковый наконечник', 'blank'],
    ['fang_inlay', 'Клыковая вставка', 'blank'],
  ] as const;
  const beastItems = RESOURCE_ITEMS.filter(item => item.resourceGroup === 'beast');
  assert.equal(beastItems.length, expected.length);
  for (const [id, name, form] of expected) {
    const item = beastItems.find(entry => entry.id === id);
    assert.ok(item, 'missing ' + id);
    assert.equal(item.name, name);
    assert.equal(item.resourceForm, form);
    assert.equal(item.level, 1);
    assert.equal(item.price, 0);
  }
});

test('bone, claw and fang recipes follow only the approved material chains', () => {
  const expected = [
    ['process_bone_blank', { bone: 3 }, 'bone_blank', 1, 60],
    ['shape_bone_plate', { bone_blank: 1 }, 'bone_plate', 1, 60],
    ['shape_bone_spike', { bone_blank: 1 }, 'bone_spike', 2, 60],
    ['prepare_bone_fragment', { bone_blank: 1 }, 'bone_fragment', 2, 45],
    ['process_claw', { claw: 3 }, 'processed_claw', 1, 90],
    ['shape_claw_element', { processed_claw: 1 }, 'claw_element', 1, 60],
    ['shape_claw_hook', { processed_claw: 1 }, 'claw_hook', 1, 90],
    ['sharpen_fang', { fang: 2 }, 'sharpened_fang', 1, 60],
    ['shape_fang_tip', { sharpened_fang: 1 }, 'fang_tip', 1, 60],
    ['prepare_fang_inlay', { sharpened_fang: 1 }, 'fang_inlay', 2, 90],
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
  assert.equal(RESOURCE_RECIPES.filter(entry => [
    'bone_blank', 'bone_plate', 'bone_spike', 'bone_fragment',
    'processed_claw', 'claw_element', 'claw_hook',
    'sharpened_fang', 'fang_tip', 'fang_inlay',
  ].includes(entry.output)).length, 10);
});

test('combined resource catalog contains exactly the four approved universal components', () => {
  const expected = [
    ['reinforced_fastening', 'Усиленное крепление'],
    ['reinforced_fabric', 'Армированная ткань'],
    ['bone_overlay', 'Костяная накладка'],
    ['reinforced_metal_node', 'Усиленный металлический узел'],
  ] as const;
  const combinedItems = RESOURCE_ITEMS.filter(item => item.resourceGroup === 'combined');
  assert.equal(combinedItems.length, expected.length);
  for (const [id, name] of expected) {
    const item = combinedItems.find(entry => entry.id === id);
    assert.ok(item, 'missing ' + id);
    assert.equal(item.name, name);
    assert.equal(item.resourceForm, 'component');
    assert.equal(item.level, 1);
    assert.equal(item.price, 0);
  }
});

test('reinforced fastening and fabric recipes support all five existing metal grades', () => {
  const metals = [
    ['copper', 1, 90, 120],
    ['iron', 10, 108, 138],
    ['steel', 20, 128, 158],
    ['deep_silver', 40, 168, 198],
    ['astralite', 60, 208, 238],
  ] as const;
  for (const [metal, level, fasteningSeconds, fabricSeconds] of metals) {
    const fastening = RESOURCE_RECIPES.find(entry => entry.id === 'make_reinforced_fastening_' + metal);
    assert.ok(fastening, 'missing reinforced fastening recipe for ' + metal);
    assert.deepEqual(fastening.materials, { ['metal_' + metal + '_wire']: 1, leather_strip: 1 });
    assert.equal(fastening.output, 'reinforced_fastening');
    assert.equal(fastening.count, 1);
    assert.equal(fastening.level, level);
    assert.equal(fastening.seconds, fasteningSeconds);
    assert.equal(fastening.workGuild, 'blacksmith');

    const fabric = RESOURCE_RECIPES.find(entry => entry.id === 'make_reinforced_fabric_' + metal);
    assert.ok(fabric, 'missing reinforced fabric recipe for ' + metal);
    assert.deepEqual(fabric.materials, { fabric: 1, ['metal_' + metal + '_wire']: 1 });
    assert.equal(fabric.output, 'reinforced_fabric');
    assert.equal(fabric.count, 1);
    assert.equal(fabric.level, level);
    assert.equal(fabric.seconds, fabricSeconds);
    assert.equal(fabric.workGuild, 'blacksmith');
  }
  assert.equal(RESOURCE_RECIPES.filter(entry => entry.output === 'reinforced_fastening').length, 5);
  assert.equal(RESOURCE_RECIPES.filter(entry => entry.output === 'reinforced_fabric').length, 5);
});

test('bone overlay uses only the approved bone plate and leather blank', () => {
  const recipe = RESOURCE_RECIPES.find(entry => entry.id === 'make_bone_overlay');
  assert.ok(recipe);
  assert.deepEqual(recipe.materials, { bone_plate: 1, leather_blank: 1 });
  assert.equal(recipe.output, 'bone_overlay');
  assert.equal(recipe.count, 1);
  assert.equal(recipe.level, 1);
  assert.equal(recipe.seconds, 90);
  assert.equal(recipe.workGuild, 'blacksmith');
});

test('reinforced metal node uses three blanks of the same metal grade', () => {
  const metals = [
    ['copper', 1, 150],
    ['iron', 10, 168],
    ['steel', 20, 188],
    ['deep_silver', 40, 228],
    ['astralite', 60, 268],
  ] as const;
  for (const [metal, level, seconds] of metals) {
    const recipe = RESOURCE_RECIPES.find(entry => entry.id === 'make_reinforced_metal_node_' + metal);
    assert.ok(recipe, 'missing reinforced metal node recipe for ' + metal);
    assert.deepEqual(recipe.materials, {
      ['metal_' + metal + '_rod']: 1,
      ['metal_' + metal + '_plate']: 1,
      ['metal_' + metal + '_wire']: 1,
    });
    assert.equal(recipe.output, 'reinforced_metal_node');
    assert.equal(recipe.count, 1);
    assert.equal(recipe.level, level);
    assert.equal(recipe.seconds, seconds);
    assert.equal(recipe.workGuild, 'blacksmith');
  }
  assert.equal(RESOURCE_RECIPES.filter(entry => entry.output === 'reinforced_metal_node').length, 5);
});

test('wood catalog keeps three source qualities and one shared blank/handle type', () => {
  const expected = [
    ['wood_common', 'Обычная древесина', 'common', 'raw', 1],
    ['wood_strong', 'Прочная древесина', 'strong', 'raw', 20],
    ['wood_rare', 'Редкая древесина', 'rare', 'raw', 40],
    ['wood_blank_common', 'Деревянная заготовка', 'common', 'blank', 1],
    ['wood_blank_strong', 'Деревянная заготовка', 'strong', 'blank', 20],
    ['wood_blank_rare', 'Деревянная заготовка', 'rare', 'blank', 40],
    ['wood_handle_common', 'Деревянная рукоять', 'common', 'component', 1],
    ['wood_handle_strong', 'Деревянная рукоять', 'strong', 'component', 20],
    ['wood_handle_rare', 'Деревянная рукоять', 'rare', 'component', 40],
  ] as const;
  const woodItems = RESOURCE_ITEMS.filter(item => item.resourceGroup === 'wood');
  assert.equal(woodItems.length, expected.length);
  for (const [id, name, quality, form, level] of expected) {
    const item = woodItems.find(entry => entry.id === id);
    assert.ok(item, 'missing ' + id);
    assert.equal(item.name, name);
    assert.equal(item.quality, quality);
    if (form === 'raw') assert.equal(item.resourceForm, undefined);
    else assert.equal(item.resourceForm, form);
    assert.equal(item.level, level);
    assert.equal(item.price, 0);
  }
  assert.equal(RESOURCE_ITEMS.filter(item => item.name === 'Деревянная заготовка').length, 3);
  assert.equal(RESOURCE_ITEMS.filter(item => item.name === 'Деревянная рукоять').length, 3);
});

test('wood processing preserves quality through one universal blank and one universal handle', () => {
  const expected = [
    ['process_wood_blank_common', { wood_common: 3 }, 'wood_blank_common', 1, 60],
    ['process_wood_blank_strong', { wood_strong: 3 }, 'wood_blank_strong', 20, 120],
    ['process_wood_blank_rare', { wood_rare: 3 }, 'wood_blank_rare', 40, 180],
    ['make_wood_handle_common', { wood_blank_common: 1 }, 'wood_handle_common', 1, 60],
    ['make_wood_handle_strong', { wood_blank_strong: 1 }, 'wood_handle_strong', 20, 90],
    ['make_wood_handle_rare', { wood_blank_rare: 1 }, 'wood_handle_rare', 40, 120],
  ] as const;
  for (const [id, materials, output, level, seconds] of expected) {
    const recipe = RESOURCE_RECIPES.find(entry => entry.id === id);
    assert.ok(recipe, 'missing ' + id);
    assert.deepEqual(recipe.materials, materials);
    assert.equal(recipe.output, output);
    assert.equal(recipe.count, 1);
    assert.equal(recipe.level, level);
    assert.equal(recipe.seconds, seconds);
    assert.equal(recipe.workGuild, 'blacksmith');
  }
  assert.equal(RESOURCE_RECIPES.filter(entry => entry.output.startsWith('wood_blank_')).length, 3);
  assert.equal(RESOURCE_RECIPES.filter(entry => entry.output.startsWith('wood_handle_')).length, 3);
});

test('leaves, roots and wood resin remain shared organic raw resources without processing chains', () => {
  for (const [id, name] of [['wood_resin', 'Древесная смола'], ['roots', 'Корни'], ['leaves', 'Листья']] as const) {
    const item = RESOURCE_ITEMS.find(entry => entry.id === id);
    assert.ok(item, 'missing ' + id);
    assert.equal(item.name, name);
    assert.equal(item.resourceGroup, 'organic');
    assert.equal(item.level, 1);
    assert.equal(item.price, 0);
  }
  assert.equal(RESOURCE_ITEMS.find(entry => entry.id === 'leaves')?.resourceForm, 'raw');
  assert.equal(RESOURCE_RECIPES.some(entry => ['wood_resin', 'roots', 'leaves'].includes(entry.output)), false);
});



test('new armor catalog replaces the old active armor without deleting legacy item IDs', () => {
  const armor = EQUIPMENT_CATALOG.filter(item => item.kind === 'armor');
  const active = armor.filter(item => item.id.startsWith('armor_'));
  const legacy = armor.filter(item => !item.id.startsWith('armor_'));
  assert.equal(EQUIPMENT_CATALOG.length, 465);
  assert.equal(armor.length, 398);
  assert.equal(active.length, 78);
  assert.equal(legacy.length, 320);
  assert.ok(legacy.every(item => item.legacy === true));
  assert.ok(active.every(item => item.legacy === false));
  assert.equal(new Set(EQUIPMENT_CATALOG.map(item => item.id)).size, EQUIPMENT_CATALOG.length);
  assert.deepEqual([...new Set(active.map(item => item.level))].sort((a,b) => a-b), [1,20,40,60,80,100]);
  assert.ok(active.every(item =>
    item.price === 0 &&
    Number.isInteger(item.defense) &&
    ['armor','helmet','gloves','boots','cloak'].includes(item.slot) &&
    !('health' in item) &&
    !('attributes' in item) &&
    !('combatStats' in item) &&
    !('effects' in item) &&
    !('set' in item) &&
    !('setBonus' in item)
  ));
});

test('new armor has exactly 78 unique recipes with valid catalog outputs and approved materials', () => {
  const activeArmor = EQUIPMENT_CATALOG.filter(item => item.kind === 'armor' && item.id.startsWith('armor_'));
  const activeIds = new Set(activeArmor.map(item => item.id));
  const allItemIds = new Set([...EQUIPMENT_CATALOG.map(item => item.id), ...RESOURCE_ITEMS.map(item => item.id)]);
  assert.equal(ARMOR_RECIPES.length, 78);
  assert.equal(new Set(ARMOR_RECIPES.map(recipe => recipe.id)).size, 78);
  assert.equal(new Set([...RESOURCE_RECIPES, ...ARMOR_RECIPES].map(recipe => recipe.id)).size, RESOURCE_RECIPES.length + 78);
  for (const recipe of ARMOR_RECIPES) {
    assert.ok(recipe.id.startsWith('craft_armor_'));
    assert.ok(activeIds.has(recipe.output), 'missing active output ' + recipe.output);
    assert.equal(recipe.count, 1);
    assert.equal(recipe.workGuild, 'blacksmith');
    assert.ok([1,20,40,60,80,100].includes(recipe.level));
    assert.ok(Number.isInteger(recipe.seconds) && recipe.seconds >= 180 && recipe.seconds <= 600);
    assert.match(recipe.name, /^Рецепт: .+ — (I|II|III|IV|V|VI)$/);
    assert.ok(recipe.description.includes('соответствующей ступени'));
    assert.ok(Object.keys(recipe.materials).length > 0);
    for (const [materialId, quantity] of Object.entries(recipe.materials)) {
      assert.ok(allItemIds.has(materialId), 'unknown material ' + materialId + ' in ' + recipe.id);
      assert.ok(Number.isInteger(quantity) && quantity > 0 && quantity <= 30);
    }
  }
});
