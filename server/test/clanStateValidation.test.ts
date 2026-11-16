import assert from 'node:assert/strict';
import test from 'node:test';
import { findPlayerClanMembership, validateClanStore, validateClanWarStore, validateTerritoryStore } from '../src/clanStateValidation.js';

const clans = {
  clan_a: { id: 'clan_a', name: 'Туманный дозор', leader: 'p1', level: 1, xp: 0, vault: 0, seasonPoints: 0,
    upgrades: { barracks: 0, treasury: 0, banner: 0 },
    members: [{ id: 'p1', name: 'Игрок', role: 'Лидер', contribution: 0, joinedAt: 100 }] },
};

test('valid clan records and legacy records with omitted optional counters remain loadable', () => {
  assert.equal(validateClanStore(clans), true);
  const legacy = { clan_a: { ...clans.clan_a, xp: undefined, seasonPoints: undefined, upgrades: undefined } };
  assert.equal(validateClanStore(legacy), true);
  const legacyLeaderless = { clan_a: { ...clans.clan_a, leader: undefined } };
  assert.equal(validateClanStore(legacyLeaderless), true);
});

test('malformed clan identity, level, roster, duplicate members and upgrades fail closed', () => {
  const cases = [
    { ...clans.clan_a, id: 'other' }, { ...clans.clan_a, level: 11 },
    { ...clans.clan_a, level: 1.5 }, { ...clans.clan_a, members: [] },
    { ...clans.clan_a, members: [{ id: 'p1' }, { id: 'p1' }] },
    { ...clans.clan_a, leader: 'missing' }, { ...clans.clan_a, upgrades: { barracks: 6 } },
    { ...clans.clan_a, vault: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const clan of cases) assert.equal(validateClanStore({ clan_a: clan }), false);
  const second = { ...clans.clan_a, id: 'clan_b', name: 'Другой клан' };
  assert.equal(validateClanStore({ ...clans, clan_b: second }), false, 'a player cannot belong to two persisted clans');
});

test('territory ownership must be unique, known and refer to an existing clan', () => {
  const valid = [{ id: 'crossroads', owner: 'clan_a', capturedAt: 100, defense: 12 }];
  assert.equal(validateTerritoryStore(valid, clans), true);
  assert.equal(validateTerritoryStore([{ ...valid[0], owner: 'deleted_clan' }], clans), false);
  assert.equal(validateTerritoryStore([valid[0], valid[0]], clans), false);
  assert.equal(validateTerritoryStore([{ ...valid[0], defense: -1 }], clans), false);
  assert.equal(validateTerritoryStore([{ ...valid[0], id: 'unknown' }], clans), false);
});


const validWar = (overrides: Record<string, unknown> = {}) => ({
  id: 'war-1', a: 'clan_a', b: 'clan_b', status: 'active', endsAt: 50_000,
  aDamage: 0, bDamage: 0, lastAttackAtByPlayer: {}, createdAt: 1_000,
  aName: 'Туманный дозор', bName: 'Северный ветер', ...overrides,
});
const twoClans = {
  ...clans,
  clan_b: { ...clans.clan_a, id: 'clan_b', name: 'Северный ветер', leader: 'p2', members: [{ id: 'p2' }] },
};

test('clan war validation accepts active records and legacy optional fields', () => {
  assert.equal(validateClanWarStore([validWar()], twoClans), true);
  assert.equal(validateClanWarStore([validWar({ aDamage: undefined, bDamage: undefined, createdAt: undefined, lastAttackAtByPlayer: undefined })], twoClans), true);
});

test('clan war validation rejects duplicate identities, invalid states and broken active clan references', () => {
  assert.equal(validateClanWarStore([validWar(), validWar()], twoClans), false);
  for (const war of [
    validWar({ id: '' }), validWar({ status: 'pending' }), validWar({ a: 'clan_a', b: 'clan_a' }),
    validWar({ a: 'missing-clan' }), validWar({ endsAt: -1 }), validWar({ endsAt: 1.5 }),
    validWar({ aDamage: -1 }), validWar({ bDamage: Number.MAX_SAFE_INTEGER + 1 }),
    validWar({ winnerId: 'unrelated-clan' }), validWar({ reward: 1.25 }),
    validWar({ lastAttackAtByPlayer: { p1: 0 } }), validWar({ lastAttackAtByPlayer: { p1: '1000' } }),
  ]) assert.equal(validateClanWarStore([war], twoClans), false);
});

test('historical wars may retain references to clans that were later disbanded', () => {
  assert.equal(validateClanWarStore([
    validWar({ status: 'finished', a: 'deleted-clan', b: 'clan_b', winnerId: 'deleted-clan', finishedAt: 60_000, reward: 150 }),
    validWar({ id: 'war-cancelled', status: 'cancelled', a: 'deleted-clan', b: 'also-deleted', winnerId: '', finishedAt: 60_000, reward: 0 }),
  ], twoClans), true);
});


test('player clan membership lookup detects roster membership independently of saved player.clan', () => {
  assert.equal(findPlayerClanMembership(twoClans, 'p1'), 'clan_a');
  assert.equal(findPlayerClanMembership(twoClans, 'p2'), 'clan_b');
  assert.equal(findPlayerClanMembership(twoClans, 'missing-player'), null);
  assert.equal(findPlayerClanMembership(twoClans, ''), null);
});
