import assert from 'node:assert/strict';
import test from 'node:test';

import { getProfessionArchetype, getProfessionWeaponStyle, isProfessionAllowedForRace, normalizeProfession, PROFESSIONS } from '../src/professionProfiles.js';

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
