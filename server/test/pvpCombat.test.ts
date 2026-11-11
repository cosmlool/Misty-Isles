import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePvpCombatStats } from '../src/pvpCombat.js';

const base = {
  strength: 100, dexterity: 80, intelligence: 60, defense: 90, vitality: 70,
  weaponAttack: 50, weaponEnhancementLevel: 0, armorDefense: 40, armorEnhancementLevel: 0,
  hasAttackSet: false, hasDefenseSet: false, hasCritSet: false,
  attackBuff: 0, defenseBuff: 0, critBuff: 0, attackRoll: 0, scoreRoll: 0,
};

test('PvP base archetypes are characterized for all eight race professions', () => {
  const cases = [
    ['Боевой маг', 91.5, 161.5, 156.1],
    ['Ассасин', 189, 161.5, 235.6],
    ['Рыцарь', 167, 177.65, 238.06],
    ['Баффер', 167, 171.118, 235.4472],
    ['Лучник', 189, 161.5, 229.9],
    ['Ассасин птицы', 189, 161.5, 235.6],
    ['Вампир', 189, 161.5, 229.9],
    ['Добытчик', 167, 161.5, 232.0],
  ] as const;
  for (const [profession, attack, defense, score] of cases) {
    const actual = calculatePvpCombatStats({ ...base, profession });
    assert.ok(Math.abs(actual.attack - attack) < 1e-9, profession + ' attack');
    assert.ok(Math.abs(actual.defense - defense) < 1e-9, profession + ' defense');
    assert.ok(Math.abs(actual.score - score) < 1e-9, profession + ' score');
  }
});

test('PvP preserves sharpening, weapon and armor properties, set tiers, buffs and injected random rolls', () => {
  const actual = calculatePvpCombatStats({
    ...base,
    profession: 'Ассасин',
    weaponAttack: 100,
    weaponEnhancementLevel: 5,
    armorDefense: 80,
    armorEnhancementLevel: 3,
    weaponProperty: { effect: 'attack', value: 0.1 },
    armorProperty: { effect: 'defense', value: 0.2 },
    hasAttackSet: true,
    hasDefenseSet: true,
    hasCritSet: true,
    attackBuff: 0.15,
    defenseBuff: 0.1,
    critBuff: 0.12,
    attackRoll: 7,
    scoreRoll: 13,
  });
  assert.ok(Math.abs(actual.attack - 303.895) < 1e-9);
  assert.ok(Math.abs(actual.defense - 254.8368) < 1e-9);
  assert.ok(Math.abs(actual.score - 441.7332) < 1e-9);
});

test('PvP critical properties are read from weapon and armor independently', () => {
  const actual = calculatePvpCombatStats({
    ...base,
    profession: 'Лучник',
    weaponProperty: { effect: 'crit', value: 0.1 },
    armorProperty: { effect: 'crit', value: 0.05 },
    attackRoll: 2,
    scoreRoll: 3,
  });
  assert.ok(Math.abs(actual.score - 265.66) < 1e-9);
});

test('PvP five-piece armor slots are intentionally outside this formula input', () => {
  const actual = calculatePvpCombatStats({ ...base, profession: 'Рыцарь' });
  assert.deepEqual(Object.keys(actual).sort(), ['attack', 'defense', 'score']);
});
