import assert from 'node:assert/strict';
import test from 'node:test';
import { validateClanStore, validateTerritoryStore } from '../src/clanStateValidation.js';

const clans = {
  clan_a: { id: 'clan_a', name: 'Туманный дозор', leader: 'p1', level: 1, xp: 0, vault: 0, seasonPoints: 0,
    upgrades: { barracks: 0, treasury: 0, banner: 0 },
    members: [{ id: 'p1', name: 'Игрок', role: 'Лидер', contribution: 0, joinedAt: 100 }] },
};

test('valid clan records and legacy records with omitted optional counters remain loadable', () => {
  assert.equal(validateClanStore(clans), true);
  const legacy = { clan_a: { ...clans.clan_a, xp: undefined, seasonPoints: undefined, upgrades: undefined } };
  assert.equal(validateClanStore(legacy), true);
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
