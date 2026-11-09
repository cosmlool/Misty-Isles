import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculatePvpGoldTransfer,
  isKnownPvpBotId,
  isPvpTargetOffered,
  pvpCooldownRemaining,
  pvpImmunityRemaining,
  selectPvpOpponents,
  PVP_ATTACK_COOLDOWN_MS,
  PVP_GOLD_STEAL_RATE,
  PVP_IMMUNITY_MS,
} from '../src/pvpOperations.js';

test('only the four catalogued arena bots are valid bot targets', () => {
  for (const id of ['bot_ember', 'bot_bastion', 'bot_gale', 'bot_relic']) {
    assert.equal(isKnownPvpBotId(id), true);
  }
  assert.equal(isKnownPvpBotId('bot_admin'), false);
  assert.equal(isKnownPvpBotId('bot_anything'), false);
  assert.equal(isKnownPvpBotId(''), false);
});

test('PvP rules use a fifteen-minute attacker cooldown and one-hour victim immunity', () => {
  assert.equal(PVP_ATTACK_COOLDOWN_MS, 15 * 60 * 1000);
  assert.equal(PVP_IMMUNITY_MS, 60 * 60 * 1000);
  assert.equal(pvpCooldownRemaining(1_000, 1_000 + PVP_ATTACK_COOLDOWN_MS - 1), 1);
  assert.equal(pvpCooldownRemaining(1_000, 1_000 + PVP_ATTACK_COOLDOWN_MS), 0);
  assert.equal(pvpImmunityRemaining({ quests: JSON.stringify({ pvp: { immunityUntil: 5_000 } }) }, 4_000), 1_000);
  assert.equal(pvpImmunityRemaining({ quests: '{}' }, 4_000), 0);
});

test('matchmaking selects at most four registered characters within plus or minus two levels', () => {
  const players = {
    self: { id: 'self', race: 'Кот', level: 20 },
    low: { id: 'low', race: 'Собака', level: 18 },
    high: { id: 'high', race: 'Птица', level: 22 },
    tooLow: { id: 'tooLow', race: 'Грызун', level: 17 },
    tooHigh: { id: 'tooHigh', race: 'Кот', level: 23 },
    noCharacter: { id: 'noCharacter', race: '', level: 20 },
    protected: { id: 'protected', race: 'Собака', level: 20, quests: JSON.stringify({ pvp: { immunityUntil: 9_000 } }) },
  };
  const selected = selectPvpOpponents(players, 'self', 20, 8_000, () => 0);
  assert.deepEqual(selected.map(player => player.id).sort(), ['high', 'low']);
});

test('matchmaking randomly samples four from all eligible saved players', () => {
  const players = Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const id = 'player-' + index;
    return [id, { id, race: 'Кот', level: 30 }];
  }));
  const selected = selectPvpOpponents(players, 'attacker', 30, 0, () => 0.5);
  assert.equal(selected.length, 4);
  assert.equal(new Set(selected.map(player => player.id)).size, 4);
});

test('only targets in the server-issued four-player offer can be attacked', () => {
  assert.equal(isPvpTargetOffered(['a', 'b', 'c', 'd'], 'c'), true);
  assert.equal(isPvpTargetOffered(['a', 'b', 'c', 'd'], 'other'), false);
  assert.equal(isPvpTargetOffered(undefined, 'a'), false);
});

test('a winner receives exactly twenty percent of the loser current gold', () => {
  assert.equal(PVP_GOLD_STEAL_RATE, 0.2);
  assert.equal(calculatePvpGoldTransfer(1_000), 200);
  assert.equal(calculatePvpGoldTransfer(7), 1);
  assert.equal(calculatePvpGoldTransfer(4), 0);
  assert.equal(calculatePvpGoldTransfer(-50), 0);
  assert.equal(calculatePvpGoldTransfer(Number.NaN), 0);
});
