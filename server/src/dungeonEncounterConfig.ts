export type DungeonSpawnConfig = { monsterId: string; count: number };
export type DungeonWaveConfig = { id: string; spawns: DungeonSpawnConfig[] };
export type DungeonEncounterConfig = { id: string; waves: DungeonWaveConfig[] };
export type DungeonDefinitionConfig = { dungeonId: string; encounters: DungeonEncounterConfig[] };
export type DungeonEncounterConfigFile = { schemaVersion: 1; dungeons: DungeonDefinitionConfig[] };
export type ExpandedDungeonWave = { id: string; monsterIds: string[] };
export type ExpandedDungeonEncounter = { id: string; waves: ExpandedDungeonWave[] };
export type ExpandedDungeonDefinition = { dungeonId: string; encounters: ExpandedDungeonEncounter[] };

const MAX_WAVES_PER_ENCOUNTER = 20;
const MAX_MONSTERS_PER_SPAWN = 20;
const MAX_MONSTERS_PER_DUNGEON = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error(`Invalid dungeon encounter config: ${label} must be a valid ID.`);
  }
  return value;
}

/** Strictly validates content references and expands spawn counts without RNG or side effects. */
export function expandDungeonEncounterConfig(
  raw: unknown,
  knownDungeonIds: ReadonlySet<string>,
  knownMonsterIds: ReadonlySet<string>,
): ExpandedDungeonDefinition[] {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.dungeons) || raw.dungeons.length === 0) {
    throw new Error('Invalid dungeon encounter config: unsupported schema or empty dungeon list.');
  }

  const seenDungeons = new Set<string>();
  const expanded: ExpandedDungeonDefinition[] = [];
  for (const rawDungeon of raw.dungeons) {
    if (!isRecord(rawDungeon)) throw new Error('Invalid dungeon encounter config: dungeon must be an object.');
    const dungeonId = requireId(rawDungeon.dungeonId, 'dungeonId');
    if (!knownDungeonIds.has(dungeonId)) throw new Error(`Invalid dungeon encounter config: unknown dungeon ${dungeonId}.`);
    if (seenDungeons.has(dungeonId)) throw new Error(`Invalid dungeon encounter config: duplicate dungeon ${dungeonId}.`);
    seenDungeons.add(dungeonId);
    if (!Array.isArray(rawDungeon.encounters) || rawDungeon.encounters.length === 0) {
      throw new Error(`Invalid dungeon encounter config: ${dungeonId} has no encounters.`);
    }

    const encounterIds = new Set<string>();
    let dungeonMonsterTotal = 0;
    const encounters: ExpandedDungeonEncounter[] = [];
    for (const rawEncounter of rawDungeon.encounters) {
      if (!isRecord(rawEncounter)) throw new Error('Invalid dungeon encounter config: encounter must be an object.');
      const encounterId = requireId(rawEncounter.id, 'encounter.id');
      if (encounterIds.has(encounterId)) throw new Error(`Invalid dungeon encounter config: duplicate encounter ${encounterId}.`);
      encounterIds.add(encounterId);
      if (!Array.isArray(rawEncounter.waves) || rawEncounter.waves.length === 0 || rawEncounter.waves.length > MAX_WAVES_PER_ENCOUNTER) {
        throw new Error(`Invalid dungeon encounter config: ${encounterId} wave count is out of range.`);
      }

      const waveIds = new Set<string>();
      const waves: ExpandedDungeonWave[] = [];
      for (const rawWave of rawEncounter.waves) {
        if (!isRecord(rawWave)) throw new Error('Invalid dungeon encounter config: wave must be an object.');
        const waveId = requireId(rawWave.id, 'wave.id');
        if (waveIds.has(waveId)) throw new Error(`Invalid dungeon encounter config: duplicate wave ${waveId}.`);
        waveIds.add(waveId);
        if (!Array.isArray(rawWave.spawns) || rawWave.spawns.length === 0) {
          throw new Error(`Invalid dungeon encounter config: ${waveId} has no spawns.`);
        }

        const waveMonsterIds: string[] = [];
        const spawnIds = new Set<string>();
        for (const rawSpawn of rawWave.spawns) {
          if (!isRecord(rawSpawn)) throw new Error('Invalid dungeon encounter config: spawn must be an object.');
          const monsterId = requireId(rawSpawn.monsterId, 'spawn.monsterId');
          if (!knownMonsterIds.has(monsterId)) throw new Error(`Invalid dungeon encounter config: unknown monster ${monsterId}.`);
          if (spawnIds.has(monsterId)) throw new Error(`Invalid dungeon encounter config: duplicate spawn ${monsterId} in ${waveId}.`);
          spawnIds.add(monsterId);
          const count = rawSpawn.count;
          if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > MAX_MONSTERS_PER_SPAWN) {
            throw new Error(`Invalid dungeon encounter config: invalid spawn count for ${monsterId}.`);
          }
          dungeonMonsterTotal += count;
          if (dungeonMonsterTotal > MAX_MONSTERS_PER_DUNGEON) {
            throw new Error(`Invalid dungeon encounter config: ${dungeonId} exceeds the monster limit.`);
          }
          for (let i = 0; i < count; i++) waveMonsterIds.push(monsterId);
        }
        waves.push({ id: waveId, monsterIds: waveMonsterIds });
      }
      encounters.push({ id: encounterId, waves });
    }
    expanded.push({ dungeonId, encounters });
  }

  if (seenDungeons.size !== knownDungeonIds.size || [...knownDungeonIds].some(id => !seenDungeons.has(id))) {
    throw new Error('Invalid dungeon encounter config: every known dungeon must have exactly one definition.');
  }
  return expanded;
}
