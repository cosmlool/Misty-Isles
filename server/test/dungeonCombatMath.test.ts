import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDungeonCombatPlan } from '../src/dungeonCombatMath.js';

test('preserves the legacy single-player dungeon calculation', () => {
  const result = calculateDungeonCombatPlan({
    dungeonPower: 100,
    partySize: 1,
    bossDefense: 20,
    bossAttack: 100,
    bossAccuracy: 100,
    groupGuard: 0,
    participants: [{
      attack: 30, defense: 20, health: 100,
      outgoingResistanceMultiplier: 0.9, weaknessMultiplier: 0.95, hitMultiplier: 0.8, incomingProfessionMultiplier: 1, incomingHitMultiplier: 1,
    }],
  });
  const perRound = 30 * 7 * (100 / 120) * 0.8;
  const rounds = Math.max(1, Math.ceil(100 * 1.35 / (perRound + 20 * 0.65)));
  assert.equal(result.rounds, rounds);
  assert.deepEqual(result.incoming, [Math.max(1, Math.floor((100 * 0.14 - 20 * 0.10) * rounds))]);
  assert.deepEqual(result.damageByParticipant, [perRound * rounds]);
  assert.equal(result.win, rounds <= 3 && 100 > result.incoming[0]);
});

test('preserves party power scaling, Knight guard and participant-specific multipliers', () => {
  const result = calculateDungeonCombatPlan({
    dungeonPower: 100,
    partySize: 2,
    bossDefense: 10,
    bossAttack: 80,
    bossAccuracy: 95,
    groupGuard: 0.08,
    participants: [
      { attack: 20, defense: 30, health: 100, outgoingResistanceMultiplier: 1, weaknessMultiplier: 1, hitMultiplier: 1, incomingProfessionMultiplier: 0.9, incomingHitMultiplier: 1 },
      { attack: 25, defense: 10, health: 90, outgoingResistanceMultiplier: 1, weaknessMultiplier: 0.7, hitMultiplier: 1, incomingProfessionMultiplier: 1, incomingHitMultiplier: 1.1 },
    ],
  });
  const attack = 20 * 7 * (100 / 110) + 25 * 7 * (100 / 110) * 0.7;
  const rounds = Math.max(1, Math.ceil((100 * (1 + 0.45)) * 1.35 / (attack + (30 + 10) * 0.65)));
  assert.equal(result.rounds, rounds);
  assert.deepEqual(result.incoming, [
    Math.max(1, Math.floor((80 * 0.14 - 30 * 0.10) * rounds * 0.92 * 0.9)),
    Math.max(1, Math.floor((80 * 0.14 - 10 * 0.10) * rounds * 0.92 * 1.1)),
  ]);
  assert.deepEqual(result.damageByParticipant, [
    20 * 7 * (100 / 110) * rounds,
    25 * 7 * (100 / 110) * 0.7 * rounds,
  ]);
});

test('victory requires every participant to survive strictly above zero HP and at most three rounds', () => {
  const base = {
    dungeonPower: 1, partySize: 1, bossDefense: 0, bossAttack: 100,
    bossAccuracy: 100, groupGuard: 0,
    participants: [{ attack: 100, defense: 0, health: 14, outgoingResistanceMultiplier: 1, weaknessMultiplier: 1, hitMultiplier: 1, incomingProfessionMultiplier: 1, incomingHitMultiplier: 1 }],
  };
  const exactLethal = calculateDungeonCombatPlan(base);
  assert.equal(exactLethal.incoming[0], 14);
  assert.equal(exactLethal.win, false);
  assert.equal(calculateDungeonCombatPlan({
    ...base, participants: [{ ...base.participants[0], health: 15 }],
  }).win, true);
});

test('rejects invalid participant counts and non-finite combat snapshots', () => {
  assert.throws(() => calculateDungeonCombatPlan({
    dungeonPower: 1, partySize: 4, bossDefense: 0, bossAttack: 1,
    bossAccuracy: 100, groupGuard: 0,
    participants: [{ attack: 1, defense: 1, health: 1, outgoingResistanceMultiplier: 1, weaknessMultiplier: 1, hitMultiplier: 1, incomingProfessionMultiplier: 1, incomingHitMultiplier: 1 }],
  }), /Invalid dungeon combat calculation input/);
  assert.throws(() => calculateDungeonCombatPlan({
    dungeonPower: 1, partySize: 1, bossDefense: 0, bossAttack: 1,
    bossAccuracy: 100, groupGuard: 0,
    participants: [{ attack: Number.NaN, defense: 1, health: 1, outgoingResistanceMultiplier: 1, weaknessMultiplier: 1, hitMultiplier: 1, incomingProfessionMultiplier: 1, incomingHitMultiplier: 1 }],
  }), /Invalid dungeon combat calculation input/);
});
