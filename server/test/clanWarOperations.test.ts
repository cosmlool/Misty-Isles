import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateClanWarDamage,
  clanWarCooldownRemaining,
  recordClanWarDamage,
  settleExpiredClanWars,
  type ClanWarRecord,
} from '../src/clanWarOperations.js';

const activeWar = (overrides: Partial<ClanWarRecord> = {}): ClanWarRecord => ({
  id: 'war-1',
  a: 'clan-a',
  b: 'clan-b',
  aDamage: 0,
  bDamage: 0,
  status: 'active',
  endsAt: 10_000,
  ...overrides,
});

test('clan war attacks use a per-player one-second cooldown', () => {
  const war = activeWar({ lastAttackAtByPlayer: { playerA: 5_000 } });
  assert.equal(clanWarCooldownRemaining(war, 'playerA', 5_999), 1);
  assert.equal(clanWarCooldownRemaining(war, 'playerA', 6_000), 0);
  assert.equal(clanWarCooldownRemaining(war, 'playerB', 5_001), 0);
});

test('an attack adds damage to the attacking clan and records its cooldown', () => {
  const war = recordClanWarDamage(activeWar(), 'clan-b', 'playerB', 37, 2_000);
  assert.equal(war.aDamage, 0);
  assert.equal(war.bDamage, 37);
  assert.equal(war.lastAttackAtByPlayer?.playerB, 2_000);
});

test('damage is derived from combat power and never falls below one', () => {
  assert.equal(calculateClanWarDamage(40, 25, 3), 18);
  assert.equal(calculateClanWarDamage(10, 50, 0), 1);
  assert.throws(() => calculateClanWarDamage(Number.NaN, 2), /finite/);
});

test('expired war awards the clan with more total damage exactly once', () => {
  const wars = [activeWar({ aDamage: 90, bDamage: 120 })];
  const clans = {
    'clan-a': { level: 2, vault: 50, seasonPoints: 4, questProgress: { war: 1 } },
    'clan-b': { level: 3, vault: 100, seasonPoints: 10, questProgress: { war: 2 } },
  };
  const first = settleExpiredClanWars(wars, clans, 10_000);
  assert.equal(first.changed, true);
  assert.equal(first.wars[0].status, 'finished');
  assert.equal(first.wars[0].winnerId, 'clan-b');
  assert.equal(first.wars[0].reward, 250);
  assert.equal(first.clans['clan-b'].vault, 350);
  assert.equal(first.clans['clan-b'].seasonPoints, 30);
  assert.equal(first.clans['clan-b'].questProgress?.war, 3);

  const second = settleExpiredClanWars(first.wars, first.clans, 11_000);
  assert.equal(second.changed, false);
  assert.equal(second.clans['clan-b'].vault, 350);
});

test('an expired tied war finishes without awarding either clan', () => {
  const clans = {
    'clan-a': { level: 1, vault: 20, seasonPoints: 0 },
    'clan-b': { level: 1, vault: 30, seasonPoints: 0 },
  };
  const result = settleExpiredClanWars([activeWar({ aDamage: 50, bDamage: 50 })], clans, 10_000);
  assert.equal(result.wars[0].winnerId, '');
  assert.equal(result.wars[0].reward, 0);
  assert.equal(result.clans['clan-a'].vault, 20);
  assert.equal(result.clans['clan-b'].vault, 30);
});

test('a war is not settled before its end time', () => {
  const result = settleExpiredClanWars([activeWar({ aDamage: 10 })], {}, 9_999);
  assert.equal(result.changed, false);
  assert.equal(result.wars[0].status, 'active');
});
