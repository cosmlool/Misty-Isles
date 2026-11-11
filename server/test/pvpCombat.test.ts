import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePvpCombatStats, resolvePvpSetBonuses } from '../src/pvpCombat.js';

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
  const baseline = calculatePvpCombatStats({ ...base, profession: 'Рыцарь' });
  const withIgnoredSlots = calculatePvpCombatStats({
    ...base, profession: 'Рыцарь', helmetDefense: 999, glovesDefense: 999,
    bootsDefense: 999, cloakDefense: 999,
  } as typeof base & Record<string, number>);
  assert.deepEqual(withIgnoredSlots, baseline);
});


test('PvP legacy sets activate at two matching IDs among weapon, armor and amulet', () => {
  const legacySets = [
    { id: 'mistwarden', items: ['mistwarden_blade', 'mistwarden_mail', 'mistwarden_charm'], effect: 'defense' },
    { id: 'shadowstalker', items: ['shadowstalker_blades', 'shadowstalker_armor', 'amulet_crit'], effect: 'crit' },
    { id: 'arcanist', items: ['arcanist_staff', 'arcanist_robe', 'amulet_power'], effect: 'attack' },
  ] as const;
  const twoPiece = resolvePvpSetBonuses(
    ['mistwarden_blade', 'mistwarden_mail', undefined], legacySets,
  );
  assert.deepEqual(twoPiece.matchedSetIds, ['mistwarden']);
  assert.equal(twoPiece.hasDefenseSet, true);
  assert.equal(twoPiece.hasAttackSet, false);
  assert.equal(twoPiece.hasCritSet, false);

  const onePiece = resolvePvpSetBonuses(
    ['mistwarden_blade', 'WPN-C-020', 'amulet_power'], legacySets,
  );
  assert.deepEqual(onePiece.matchedSetIds, []);
  assert.equal(onePiece.hasDefenseSet, false);
  assert.equal(onePiece.hasAttackSet, false);
  assert.equal(onePiece.hasCritSet, false);
});

test('PvP three-slot lookup cannot activate a new five-piece armor set', () => {
  const fivePiece = {
    id: 'armor_knight_example',
    items: ['knight_armor', 'knight_helmet', 'knight_gloves', 'knight_boots', 'knight_cloak'],
    effect: 'defense',
  };
  const result = resolvePvpSetBonuses(
    ['knight_armor', 'WPN-C-020', 'amulet_guard'],
    [fivePiece],
  );
  assert.deepEqual(result.matchedSetIds, []);
  assert.equal(result.hasDefenseSet, false);
});


test('PvP ignores catalog attributes, combatStats and amulet effects for all eight professions', () => {
  const professions = [
    'Боевой маг', 'Ассасин', 'Рыцарь', 'Баффер',
    'Лучник', 'Ассасин птицы', 'Вампир', 'Добытчик',
  ];
  for (const profession of professions) {
    const baseline = calculatePvpCombatStats({ ...base, profession });
    const withCatalogOnlyFields = calculatePvpCombatStats({
      ...base,
      profession,
      weaponAttributes: { strength: 999, dexterity: 999, intelligence: 999, vitality: 999, stamina: 999 },
      armorAttributes: { strength: 999, dexterity: 999, intelligence: 999, vitality: 999, stamina: 999 },
      weaponCombatStats: { accuracy: 99, physicalDamage: 99, magicDamage: 99, critChance: 99, evasion: 99 },
      armorCombatStats: { accuracy: 99, physicalDamage: 99, magicDamage: 99, critChance: 99, evasion: 99 },
      amuletEffect: 'attack',
      amuletValue: 99,
      amuletProperty: { effect: 'crit', value: 99 },
    } as typeof base & Record<string, unknown>);
    assert.deepEqual(withCatalogOnlyFields, baseline, profession + ' must preserve the current PvP gear input contract');
  }
});

test('PvP rare properties are slot-specific and only attack/defense/crit affect rating', () => {
  const baseline = calculatePvpCombatStats({ ...base, profession: 'Рыцарь' });
  const weaponAttack = calculatePvpCombatStats({
    ...base, profession: 'Рыцарь', weaponProperty: { effect: 'attack', value: 0.08 },
  });
  assert.ok(weaponAttack.attack > baseline.attack);
  const armorDefense = calculatePvpCombatStats({
    ...base, profession: 'Рыцарь', armorProperty: { effect: 'defense', value: 0.08 },
  });
  assert.ok(armorDefense.defense > baseline.defense);
  const weaponCrit = calculatePvpCombatStats({
    ...base, profession: 'Рыцарь', weaponProperty: { effect: 'crit', value: 0.05 },
  });
  const armorCrit = calculatePvpCombatStats({
    ...base, profession: 'Рыцарь', armorProperty: { effect: 'crit', value: 0.05 },
  });
  assert.ok(weaponCrit.score > baseline.score);
  assert.ok(armorCrit.score > baseline.score);

  for (const effect of ['lifesteal', 'loot', 'xp', 'gold']) {
    const ignored = calculatePvpCombatStats({
      ...base, profession: 'Рыцарь',
      weaponProperty: { effect, value: 0.99 },
      armorProperty: { effect, value: 0.99 },
    });
    assert.deepEqual(ignored, baseline, effect + ' property is outside current PvP rating policy');
  }
  const wrongSlots = calculatePvpCombatStats({
    ...base, profession: 'Рыцарь',
    weaponProperty: { effect: 'defense', value: 0.99 },
    armorProperty: { effect: 'attack', value: 0.99 },
  });
  assert.deepEqual(wrongSlots, baseline);
});
