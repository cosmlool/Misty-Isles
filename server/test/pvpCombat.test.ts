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
    ['Боевой маг', 172.2, 161.5, 236.8],
    ['Ассасин', 239, 161.5, 320.33],
    ['Рыцарь', 215, 177.65, 286.06],
    ['Баффер', 215, 171.19, 283.476],
    ['Лучник', 239, 161.5, 310.77],
    ['Ассасин птицы', 239, 161.5, 320.33],
    ['Вампир', 239, 161.5, 303.6],
    ['Добытчик', 215, 161.5, 279.6],
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
  assert.ok(Math.abs(actual.attack - 429.1558) < 1e-9);
  assert.ok(Math.abs(actual.defense - 300.94416) < 1e-9);
  assert.ok(Math.abs(actual.score - 669.822414) < 1e-9);
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
  assert.ok(Math.abs(actual.score - 351.98) < 1e-9);
});

test('PvP five-piece armor slots are intentionally outside this formula input', () => {
  const actual = calculatePvpCombatStats({ ...base, profession: 'Рыцарь' });
  assert.deepEqual(Object.keys(actual).sort(), ['attack', 'defense', 'score']);
});
