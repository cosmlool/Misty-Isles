import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { getProfessionArchetype, getProfessionWeaponStyle, isProfessionAllowedForRace, normalizeProfession, PROFESSIONS } from '../src/professionProfiles.js';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const equipment = JSON.parse(readFileSync(resolve(serverDir, 'data/equipment_catalog.json'), 'utf8'));

test('all eight race-profession profiles are selectable only by their intended race', () => {
  assert.deepEqual(PROFESSIONS, {
    'Кот': ['Боевой маг', 'Ассасин'],
    'Собака': ['Рыцарь', 'Баффер'],
    'Птица': ['Лучник', 'Ассасин птицы'],
    'Грызун': ['Вампир', 'Добытчик'],
  });
  for (const [race, professions] of Object.entries(PROFESSIONS)) {
    for (const profession of professions) assert.equal(isProfessionAllowedForRace(race, profession), true);
    for (const [otherRace] of Object.entries(PROFESSIONS)) {
      if (otherRace === race) continue;
      for (const profession of professions) assert.equal(isProfessionAllowedForRace(otherRace, profession), false);
    }
  }
});

test('legacy Warrior profession normalizes to Knight without changing other profession names', () => {
  assert.equal(normalizeProfession('Воин'), 'Рыцарь');
  assert.equal(normalizeProfession('Рыцарь'), 'Рыцарь');
  assert.equal(normalizeProfession('Ассасин'), 'Ассасин');
});

test('Bird Assassin has a separate single-dagger profile while Cat Assassin remains dual-dagger', () => {
  assert.equal(getProfessionArchetype('Ассасин'), 'assassin');
  assert.equal(getProfessionArchetype('Ассасин птицы'), 'assassin');
  assert.equal(getProfessionWeaponStyle('Ассасин'), 'dual-daggers');
  assert.equal(getProfessionWeaponStyle('Ассасин птицы'), 'single-dagger');
});

test('Bird Assassin has a complete bird-locked single-dagger equipment progression', () => {
  const gear = equipment.filter((item: any) => item.profession === 'Ассасин птицы');
  const weapons = gear.filter((item: any) => item.kind === 'weapon');
  const armor = gear.filter((item: any) => item.kind === 'armor');
  assert.equal(gear.length, 41);
  assert.equal(weapons.length, 6);
  assert.equal(armor.length, 35);
  assert.ok(gear.every((item: any) => item.race === 'Птица'));
  assert.ok(weapons.every((item: any) => item.weaponStyle === 'single-dagger'));
  assert.equal(new Set(armor.map((item: any) => item.set)).size, 7);
});

test('Cat Assassin keeps dual-dagger metadata and Knight keeps legacy set mastery identifiers', () => {
  const catWeapons = equipment.filter((item: any) => item.profession === 'Ассасин' && item.kind === 'weapon');
  assert.equal(catWeapons.length, 6);
  assert.ok(catWeapons.every((item: any) => item.weaponStyle === 'dual-daggers'));

  const knightArmor = equipment.filter((item: any) => item.profession === 'Рыцарь' && item.kind === 'armor');
  const tiered = knightArmor.filter((item: any) => /^Воин-(25|40|55|70|85|100)$/.test(item.set));
  assert.equal(knightArmor.length, 35);
  assert.equal(tiered.length, 30);
  assert.ok(tiered.every((item: any) => /^Рыцарь-/.test(item.setDisplayName)));
});
