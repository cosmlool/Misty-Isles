import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareXpProgression, type XpProgressionState } from '../src/xpProgression.js';

const effectiveMaxHealth = (baseMaxHealth: number) => Math.floor((baseMaxHealth + 20) * 1.1);

function player(overrides: Partial<XpProgressionState> = {}): XpProgressionState {
  return {
    experience: 0,
    level: 1,
    statPoints: 2,
    experienceToNext: 100,
    maxHealth: 100,
    health: 80,
    vitality: 10,
    ...overrides,
  };
}

test('XP below the level threshold changes experience only', () => {
  const initial = player({ experience: 25 });
  const result = prepareXpProgression(initial, 50, effectiveMaxHealth);

  assert.deepEqual(result, {
    experience: 75,
    level: 1,
    statPoints: 2,
    experienceToNext: 100,
    maxHealth: 100,
    health: 80,
  });
  assert.deepEqual(initial, player({ experience: 25 }));
});

test('one level-up preserves vitality health growth and effective equipment cap', () => {
  const result = prepareXpProgression(player({ health: 100 }), 100, effectiveMaxHealth);

  assert.deepEqual(result, {
    experience: 0,
    level: 2,
    statPoints: 5,
    experienceToNext: Math.floor(100 * Math.pow(2, 1.85)),
    maxHealth: 123,
    health: 123,
  });
});

test('multiple level-ups apply every threshold and health increase in sequence', () => {
  const result = prepareXpProgression(player({ experience: 50, health: 50 }), 2_000, effectiveMaxHealth);

  let remaining = 2_050;
  let level = 1;
  let maxHealth = 100;
  let health = 50;
  let statPoints = 2;
  while (remaining >= Math.floor(100 * Math.pow(level, 1.85))) {
    remaining -= Math.floor(100 * Math.pow(level, 1.85));
    level++;
    statPoints += 3;
    const increase = 23;
    maxHealth += increase;
    health = Math.min(effectiveMaxHealth(maxHealth), health + increase);
  }

  assert.deepEqual(result, {
    experience: remaining,
    level,
    statPoints,
    experienceToNext: Math.floor(100 * Math.pow(level, 1.85)),
    maxHealth,
    health,
  });
});

test('effective max-health resolver receives each updated base max-health value', () => {
  const received: number[] = [];
  prepareXpProgression(player(), 500, baseMaxHealth => {
    received.push(baseMaxHealth);
    return baseMaxHealth;
  });

  assert.deepEqual(received, [123, 146]);
});
