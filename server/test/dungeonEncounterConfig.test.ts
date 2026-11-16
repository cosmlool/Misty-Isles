import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { expandDungeonEncounterConfig, resolveLegacyDungeonBossId } from '../src/dungeonEncounterConfig.js';

const dungeonIds = new Set(['fl_dungeon_03', 'fl_dungeon_06', 'fl_dungeon_09', 'fl_dungeon_10']);
const monsterIds = new Set(['FL-03-10', 'FL-06-10', 'FL-09-10', 'FL-10-10']);
const legacyConfig = {
  schemaVersion: 1,
  dungeons: [
    { dungeonId: 'fl_dungeon_03', encounters: [{ id: 'legacy_boss', waves: [{ id: 'boss', spawns: [{ monsterId: 'FL-03-10', count: 1 }] }] }] },
    { dungeonId: 'fl_dungeon_06', encounters: [{ id: 'legacy_boss', waves: [{ id: 'boss', spawns: [{ monsterId: 'FL-06-10', count: 1 }] }] }] },
    { dungeonId: 'fl_dungeon_09', encounters: [{ id: 'legacy_boss', waves: [{ id: 'boss', spawns: [{ monsterId: 'FL-09-10', count: 1 }] }] }] },
    { dungeonId: 'fl_dungeon_10', encounters: [{ id: 'legacy_boss', waves: [{ id: 'boss', spawns: [{ monsterId: 'FL-10-10', count: 1 }] }] }] },
  ],
};

test('expands the four legacy dungeons to exactly their existing single boss', () => {
  const expanded = expandDungeonEncounterConfig(legacyConfig, dungeonIds, monsterIds);
  assert.deepEqual(expanded.map(dungeon => ({
    dungeonId: dungeon.dungeonId,
    monsterIds: dungeon.encounters.flatMap(encounter => encounter.waves.flatMap(wave => wave.monsterIds)),
  })), [
    { dungeonId: 'fl_dungeon_03', monsterIds: ['FL-03-10'] },
    { dungeonId: 'fl_dungeon_06', monsterIds: ['FL-06-10'] },
    { dungeonId: 'fl_dungeon_09', monsterIds: ['FL-09-10'] },
    { dungeonId: 'fl_dungeon_10', monsterIds: ['FL-10-10'] },
  ]);
});

test('expands ordered waves and repeated monster counts deterministically', () => {
  const config = {
    schemaVersion: 1,
    dungeons: [{ dungeonId: 'fl_dungeon_03', encounters: [{
      id: 'crypt', waves: [
        { id: 'first', spawns: [{ monsterId: 'FL-03-10', count: 2 }] },
        { id: 'second', spawns: [{ monsterId: 'FL-03-10', count: 1 }] },
      ],
    }] }],
    ...{},
  };
  const oneDungeonIds = new Set(['fl_dungeon_03']);
  const result = expandDungeonEncounterConfig(config, oneDungeonIds, monsterIds);
  assert.deepEqual(result[0].encounters[0].waves, [
    { id: 'first', monsterIds: ['FL-03-10', 'FL-03-10'] },
    { id: 'second', monsterIds: ['FL-03-10'] },
  ]);
});

test('rejects unsupported schema versions, missing dungeons and unknown monster references', () => {
  assert.throws(() => expandDungeonEncounterConfig({ ...legacyConfig, schemaVersion: 2 }, dungeonIds, monsterIds), /unsupported schema/);
  assert.throws(() => expandDungeonEncounterConfig({ schemaVersion: 1, dungeons: legacyConfig.dungeons.slice(1) }, dungeonIds, monsterIds), /every known dungeon/);
  const bad = structuredClone(legacyConfig);
  bad.dungeons[0].encounters[0].waves[0].spawns[0].monsterId = 'UNKNOWN';
  assert.throws(() => expandDungeonEncounterConfig(bad, dungeonIds, monsterIds), /unknown monster/);
});

test('rejects invalid counts, duplicate IDs, empty waves and oversized encounters', () => {
  const makeConfig = (spawn: unknown) => ({
    schemaVersion: 1,
    dungeons: [{ dungeonId: 'fl_dungeon_03', encounters: [{ id: 'e', waves: [{ id: 'w', spawns: [spawn] }] }] }],
  });
  assert.throws(() => expandDungeonEncounterConfig(makeConfig({ monsterId: 'FL-03-10', count: 0 }), new Set(['fl_dungeon_03']), monsterIds), /invalid spawn count/);
  assert.throws(() => expandDungeonEncounterConfig(makeConfig({ monsterId: 'FL-03-10', count: 1.5 }), new Set(['fl_dungeon_03']), monsterIds), /invalid spawn count/);
  assert.throws(() => expandDungeonEncounterConfig(makeConfig({ monsterId: 'FL-03-10', count: 21 }), new Set(['fl_dungeon_03']), monsterIds), /invalid spawn count/);
  assert.throws(() => expandDungeonEncounterConfig({ schemaVersion: 1, dungeons: [{ dungeonId: 'fl_dungeon_03', encounters: [{ id: 'e', waves: [{ id: 'w', spawns: [] }] }] }] }, new Set(['fl_dungeon_03']), monsterIds), /no spawns/);
  const oversized = { schemaVersion: 1, dungeons: [{ dungeonId: 'fl_dungeon_03', encounters: [{ id: 'e', waves: Array.from({ length: 6 }, (_, index) => ({ id: `w${index}`, spawns: [{ monsterId: 'FL-03-10', count: 20 }] })) }] }] };
  assert.throws(() => expandDungeonEncounterConfig(oversized, new Set(['fl_dungeon_03']), monsterIds), /exceeds the monster limit/);
});

test('checked-in encounter configuration exactly preserves the live dungeon boss targets', () => {
  const world = JSON.parse(readFileSync(new URL('../data/forgotten_lands.json', import.meta.url), 'utf8'));
  const config = JSON.parse(readFileSync(new URL('../data/dungeon_encounters.json', import.meta.url), 'utf8'));
  const knownDungeonIds = new Set(world.dungeons.map((dungeon: { id: string }) => dungeon.id));
  const knownMonsterIds = new Set(world.monsters.map((monster: { id: string }) => monster.id));
  const expanded = expandDungeonEncounterConfig(config, knownDungeonIds, knownMonsterIds);
  assert.equal(expanded.length, world.dungeons.length);
  for (const dungeon of world.dungeons) {
    const entry = expanded.find(candidate => candidate.dungeonId === dungeon.id);
    assert.ok(entry, `missing encounter config for ${dungeon.id}`);
    assert.deepEqual(entry.encounters.flatMap(encounter => encounter.waves.flatMap(wave => wave.monsterIds)), [dungeon.bossId]);
  }
});

test('legacy adapter returns the original boss and refuses multi-encounter content', () => {
  const expanded = expandDungeonEncounterConfig(legacyConfig, dungeonIds, monsterIds);
  assert.deepEqual(expanded.map(resolveLegacyDungeonBossId), ['FL-03-10', 'FL-06-10', 'FL-09-10', 'FL-10-10']);
  assert.throws(() => resolveLegacyDungeonBossId({
    dungeonId: 'fl_dungeon_03',
    encounters: [
      { id: 'a', waves: [{ id: 'a1', monsterIds: ['FL-03-10'] }] },
      { id: 'b', waves: [{ id: 'b1', monsterIds: ['FL-03-10'] }] },
    ],
  }), /exactly one encounter/);
  assert.throws(() => resolveLegacyDungeonBossId({
    dungeonId: 'fl_dungeon_03',
    encounters: [{ id: 'a', waves: [{ id: 'a1', monsterIds: ['FL-03-10', 'FL-03-10'] }] }],
  }), /exactly one boss spawn/);
  assert.throws(() => resolveLegacyDungeonBossId({
    dungeonId: 'fl_dungeon_03',
    encounters: [{ id: 'a', waves: [{ id: 'a1', monsterIds: ['FL-03-10'] }, { id: 'a2', monsterIds: ['FL-03-10'] }] }],
  }), /exactly one boss spawn/);
});
