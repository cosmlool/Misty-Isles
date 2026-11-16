import {
  validatePreparedDungeonEncounter,
  type PreparedDungeonEncounter,
} from './dungeonEncounterPreparation.js';
import {
  validateDungeonRunStore,
  type DungeonRunRecord,
  type DungeonRunStore,
} from './dungeonRunState.js';

export type PreparedDungeonEncounterCommit = {
  run: DungeonRunRecord;
  runs: DungeonRunStore;
  alreadyPrepared: boolean;
};

function samePreparedEncounter(a: PreparedDungeonEncounter, b: PreparedDungeonEncounter): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Attaches the immutable, fully calculated legacy settlement to its active
 * durable run. This does not apply rewards to live players: it only persists
 * the exact result so restart/retry paths can consume it without rerolling.
 */
export function prepareDungeonEncounterCommit(input: {
  runId: string;
  runs: DungeonRunStore;
  encounter: PreparedDungeonEncounter;
}): PreparedDungeonEncounterCommit {
  if (!input.runId) throw new Error('A dungeon run ID is required to persist an encounter.');
  const prepared = validatePreparedDungeonEncounter(input.encounter);
  const runs = validateDungeonRunStore(input.runs);
  const current = runs[input.runId];
  if (!current) throw new Error('Cannot persist an encounter for a missing dungeon run.');
  if (current.status !== 'active') throw new Error('Cannot attach a prepared encounter to a terminal dungeon run.');
  if (prepared.runId !== current.runId || prepared.requestId !== current.requestId ||
      prepared.dungeonId !== current.dungeonId || prepared.bossId !== current.encounter.bossId ||
      JSON.stringify(prepared.participantIds) !== JSON.stringify(current.participantIds) ||
      prepared.preparedAt < current.startedAt) {
    throw new Error('Prepared encounter identity does not match the durable dungeon run.');
  }
  if (current.preparedEncounter) {
    const existing = validatePreparedDungeonEncounter(current.preparedEncounter);
    if (!samePreparedEncounter(existing, prepared)) {
      throw new Error('A different prepared encounter is already committed for this dungeon run.');
    }
    return { run: current, runs, alreadyPrepared: true };
  }
  const nextRun: DungeonRunRecord = {
    ...current,
    updatedAt: Math.max(current.updatedAt, prepared.preparedAt),
    preparedEncounter: prepared,
  };
  const nextRuns = validateDungeonRunStore({ ...runs, [input.runId]: nextRun });
  return { run: nextRun, runs: nextRuns, alreadyPrepared: false };
}

type DungeonEncounterCommitRuntime = {
  transact<T>(prepare: (recovered: boolean) => {
    files: { players: Record<string, Record<string, unknown>>; dungeonRuns: DungeonRunStore };
    result: T;
    skipWrite?: boolean;
  }): T;
};

/** Commits the frozen encounter snapshot to dungeon_runs.json through shared WAL. */
export function commitPreparedDungeonEncounter(input: {
  runtime: DungeonEncounterCommitRuntime;
  runId: string;
  runs: DungeonRunStore;
  players: Record<string, Record<string, unknown>>;
  encounter: PreparedDungeonEncounter;
}): PreparedDungeonEncounterCommit {
  return input.runtime.transact(recovered => {
    if (recovered) {
      throw new Error('Shared state was recovered during encounter preparation; reload player and run snapshots before retrying.');
    }
    const prepared = prepareDungeonEncounterCommit(input);
    return {
      files: { players: input.players, dungeonRuns: prepared.runs },
      result: prepared,
      skipWrite: prepared.alreadyPrepared,
    };
  });
}
