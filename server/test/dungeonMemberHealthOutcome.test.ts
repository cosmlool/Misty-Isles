import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareDungeonMemberHealthOutcome } from '../src/dungeonMemberHealthOutcome.js';

test('applies incoming damage before lifesteal and preserves the health floor', () => {
  assert.equal(prepareDungeonMemberHealthOutcome({
    health: 100, incomingDamage: 30, maxHealth: 120, lifestealRate: 0.2, attack: 50,
  }), 80);
  assert.equal(prepareDungeonMemberHealthOutcome({
    health: 10, incomingDamage: 20, maxHealth: 120,
  }), 1);
});

test('applies buffer healing after lifesteal and caps each stage at max health', () => {
  assert.equal(prepareDungeonMemberHealthOutcome({
    health: 115, incomingDamage: 0, maxHealth: 120,
    lifestealRate: 0.2, attack: 100, healingMultiplier: 1, hasBuffer: true,
  }), 120);
  assert.equal(prepareDungeonMemberHealthOutcome({
    health: 30, incomingDamage: 10, maxHealth: 100, hasBuffer: true,
  }), 24);
});

test('uses the supplied healing multiplier for both healing sources', () => {
  assert.equal(prepareDungeonMemberHealthOutcome({
    health: 50, incomingDamage: 10, maxHealth: 100,
    lifestealRate: 0.1, attack: 100, healingMultiplier: 0.5, hasBuffer: true,
  }), 47);
});

test('loss outcome applies damage only when no healing sources are supplied', () => {
  assert.equal(prepareDungeonMemberHealthOutcome({
    health: 80, incomingDamage: 25, maxHealth: 100,
  }), 55);
});
