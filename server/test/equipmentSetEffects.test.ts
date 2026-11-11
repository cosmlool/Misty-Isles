import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  resolveEquipmentSetEffects,
  validateEquipmentSetCatalog,
  validateEquipmentSetEffects,
  validateEquipmentSetDefinitions,
  type EquipmentSetEffect,
} from '../src/equipmentSetEffects.js';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const equipment = JSON.parse(readFileSync(resolve(serverDir, 'data/equipment_catalog.json'), 'utf8'));

test('current equipment catalog has 57 structurally complete five-piece sets', () => {
  assert.deepEqual(validateEquipmentSetCatalog(equipment), []);
  const setNames = new Set(equipment.filter((item: any) => item.set).map((item: any) => item.set));
  assert.equal(setNames.size, 57);
});

test('set effect schema accepts typed targets, explicit scope and cumulative tiers', () => {
  const effects: EquipmentSetEffect[] = [
    { pieces: 2, target: 'critChance', value: 0.01, scope: ['hunt', 'dungeon'] },
    { pieces: 3, target: 'attributePercent', attribute: 'dexterity', value: 0.02, scope: ['hunt'] },
    { pieces: 4, target: 'accuracy', value: 0.03, scope: ['hunt', 'pvp'] },
    { pieces: 5, target: 'critDamage', value: 0.04, scope: ['hunt'], trigger: 'onCrit' },
  ];
  assert.deepEqual(validateEquipmentSetEffects(effects), []);
  assert.deepEqual(resolveEquipmentSetEffects(effects, 1, 'hunt'), []);
  assert.deepEqual(resolveEquipmentSetEffects(effects, 2, 'hunt'), [effects[0]]);
  assert.deepEqual(resolveEquipmentSetEffects(effects, 3, 'hunt'), effects.slice(0, 2));
  assert.deepEqual(resolveEquipmentSetEffects(effects, 4, 'hunt'), effects.slice(0, 3));
  assert.deepEqual(resolveEquipmentSetEffects(effects, 5, 'hunt'), effects);
  assert.deepEqual(resolveEquipmentSetEffects(effects, 5, 'pvp'), [effects[2]]);
});

test('set effect schema rejects unknown channels, invalid values and malformed scopes', () => {
  const invalid = [
    { pieces: 6, target: 'attack', value: 0.1, scope: ['hunt'] },
    { pieces: 2, target: 'unknown-to-combat', value: 0.1, scope: ['hunt'] },
    { pieces: 3, target: 'attack', value: Number.NaN, scope: ['hunt'] },
    { pieces: 4, target: 'defense', value: -0.1, scope: ['hunt'] },
    { pieces: 5, target: 'health', value: 0.1, scope: [] },
    { pieces: 2, target: 'health', value: 0.1, scope: ['arena'] },
    { pieces: 3, target: 'health', value: 0.1, scope: ['hunt', 'hunt'] },
    { pieces: 4, target: 'attributePercent', value: 0.1, scope: ['hunt'] },
    { pieces: 5, target: 'critChance', attribute: 'strength', value: 0.1, scope: ['hunt'] },
  ];
  assert.ok(validateEquipmentSetEffects(invalid).length >= invalid.length);
});

test('Gatherer Spoil and Sweep chances respect 80% cap and Sweep dependency', () => {
  const valid = [
    { pieces: 2, target: 'spoilChance', value: 0.8, scope: ['hunt'] },
    { pieces: 3, target: 'sweepChance', value: 0.8, scope: ['hunt'], trigger: 'onSpoilSuccess' },
  ];
  assert.deepEqual(validateEquipmentSetEffects(valid), []);
  const invalid = [
    { pieces: 2, target: 'spoilChance', value: 0.81, scope: ['hunt'] },
    { pieces: 3, target: 'sweepChance', value: 0.8, scope: ['hunt'] },
  ];
  const errors = validateEquipmentSetEffects(invalid);
  assert.ok(errors.some(error => error.includes('80%')));
  assert.ok(errors.some(error => error.includes('onSpoilSuccess')));
});

test('catalog validator detects incomplete, duplicate-slot and mixed-description sets', () => {
  const malformed = [
    { id: 'one', set: 'broken', slot: 'helmet', profession: 'Воин', setBonus: 'A' },
    { id: 'two', set: 'broken', slot: 'helmet', profession: 'Лучник', setBonus: 'B' },
  ];
  const errors = validateEquipmentSetCatalog(malformed);
  assert.ok(errors.some(error => error.includes('exactly five')));
  assert.ok(errors.some(error => error.includes('duplicate slots')));
  assert.ok(errors.some(error => error.includes('mixes professions')));
  assert.ok(errors.some(error => error.includes('inconsistent setBonus')));
});

test('catalog validator rejects armor without a set, non-armor set members and global duplicate ids', () => {
  const malformed = [
    { id: 'armor-without-set', kind: 'armor', slot: 'helmet' },
    { id: 'weapon-in-set', kind: 'weapon', slot: 'weapon', set: 'not-armor' },
    { id: 'duplicate-id', kind: 'weapon', slot: 'weapon' },
    { id: 'duplicate-id', kind: 'armor', slot: 'helmet', set: 'partial' },
  ];
  const errors = validateEquipmentSetCatalog(malformed);
  assert.ok(errors.some(error => error.includes('armor item has no valid set')));
  assert.ok(errors.some(error => error.includes('non-armor item cannot belong')));
  assert.ok(errors.some(error => error.includes('duplicates item id')));
  assert.ok(errors.some(error => error.includes('exactly five')));
});

test('catalog validator rejects non-object catalog entries instead of silently skipping them', () => {
  const errors = validateEquipmentSetCatalog([null, 'not-an-item']);
  assert.ok(errors.some(error => error.includes('catalog[0] must be an object')));
  assert.ok(errors.some(error => error.includes('catalog[1] must be an object')));
});


test('catalog profession coverage matches the seven live professions and excludes planned profiles', () => {
  const armor = equipment.filter((item: any) => item.kind === 'armor');
  const professionSetCounts = new Map<string, Set<string>>();
  for (const item of armor) {
    if (typeof item.profession !== 'string') continue;
    const sets = professionSetCounts.get(item.profession) ?? new Set<string>();
    sets.add(item.set);
    professionSetCounts.set(item.profession, sets);
  }

  assert.deepEqual([...professionSetCounts.keys()].sort(), [
    'Ассасин', 'Баффер', 'Боевой маг', 'Воин', 'Вампир', 'Добытчик', 'Лучник',
  ].sort());
  for (const profession of professionSetCounts.keys()) {
    assert.equal(professionSetCounts.get(profession)?.size, 7, profession);
  }
  assert.equal(professionSetCounts.has('Рыцарь'), false);
  assert.equal(professionSetCounts.has('Ассасин птицы'), false);
});

test('one catalog armor set cannot be registered by multiple structured definitions', () => {
  const setItems = equipment.filter((item: any) => item.set === 'Маг-25');
  const definition = {
    id: 'armor_mag_25',
    name: 'Маг-25',
    profession: 'Боевой маг',
    itemIds: setItems.map((item: any) => item.id),
    thresholds: {},
  };
  const duplicate = { ...definition, id: 'duplicate_mag_25', name: 'Duplicate Mag 25' };
  const errors = validateEquipmentSetDefinitions([definition, duplicate], equipment);
  assert.ok(errors.some(error => error.includes('duplicates a catalog set definition')));
});

test('structured set definitions validate five catalog members and explicit threshold ownership', () => {
  const setItems = equipment.filter((item: any) => item.set === 'Маг-25');
  const definition = {
    id: 'armor_mag_25',
    name: 'Маг-25',
    profession: 'Боевой маг',
    itemIds: setItems.map((item: any) => item.id),
    thresholds: {
      2: [{ pieces: 2, target: 'attack', value: 0.01, scope: ['hunt'] }],
      3: [{ pieces: 3, target: 'attributePercent', attribute: 'intelligence', value: 0.01, scope: ['hunt'] }],
    },
  };
  assert.deepEqual(validateEquipmentSetDefinitions([definition], equipment), []);
});

test('structured set definitions reject duplicate, foreign and incorrectly tiered members/effects', () => {
  const setItems = equipment.filter((item: any) => item.set === 'Маг-25');
  const definition = {
    id: 'armor_mag_25',
    name: 'Маг-25',
    profession: 'Боевой маг',
    itemIds: [setItems[0].id, setItems[0].id, ...setItems.slice(2).map((item: any) => item.id)],
    thresholds: {
      2: [{ pieces: 3, target: 'attack', value: 0.01, scope: ['hunt'] }],
      6: [],
    },
  };
  const errors = validateEquipmentSetDefinitions([definition], equipment);
  assert.ok(errors.some(error => error.includes('itemIds contains duplicates')));
  assert.ok(errors.some(error => error.includes('match all five')));
  assert.ok(errors.some(error => error.includes('unsupported tier 6')));
  assert.ok(errors.some(error => error.includes('assigned to another tier')));
});
