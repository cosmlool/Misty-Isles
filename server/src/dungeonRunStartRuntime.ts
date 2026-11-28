import type { SharedStateSnapshot } from './sharedStateTransactions.js';
import {
  prepareDungeonRunStart,
  type DungeonStartPlayerSnapshot,
  type PreparedDungeonRunStart,
} from './dungeonRunStartTransaction.js';
import type { DungeonRunRecord, DungeonRunStore } from './dungeonRunState.js';
import { prepareDungeonRunExecution } from './dungeonRunExecutionPreparation.js';
import type { PreparedDungeonEncounter } from './dungeonEncounterPreparation.js';

type DungeonEntryRuntime = {
  transactWithRecovery<T>(prepare: (recovery: { recovered: boolean; playersRecovered: boolean }) => {
    files: SharedStateSnapshot;
    result: T;
    skipWrite?: boolean;
  }): T;
};

/**
 * Commits the attempt counters and active run in one shared-WAL transaction.
 * Callers must supply the complete, current players snapshot and current run
 * store. If recovery changed disk state, this rejects so the caller can reload
 * online players and retry instead of overwriting recovered data.
 */
export function commitDungeonRunStart(input: {
  runtime: DungeonEntryRuntime;
  run: DungeonRunRecord;
  players: Record<string, DungeonStartPlayerSnapshot>;
  runs: DungeonRunStore;
  day: string;
  dailyLimit?: number;
  encounter?: PreparedDungeonEncounter;
}): PreparedDungeonRunStart {
  return input.runtime.transactWithRecovery(recovery => {
    if (recovery.recovered) {
      throw new Error('Shared state was recovered during dungeon entry; reload player and run snapshots before retrying.');
    }
    const prepared = prepareDungeonRunStart({
      run: input.run,
      players: input.players,
      runs: input.runs,
      day: input.day,
      dailyLimit: input.dailyLimit,
    });
    if (!input.encounter) {
      return {
        files: { players: prepared.players, dungeonRuns: prepared.runs },
        result: prepared,
        skipWrite: prepared.alreadyStarted,
      };
    }
    const execution = prepareDungeonRunExecution({
      runId: prepared.run.runId,
      runs: prepared.runs,
      encounter: input.encounter,
    });
    const committed = { ...prepared, run: execution.run, runs: execution.runs };
    return {
      files: { players: committed.players, dungeonRuns: committed.runs },
      result: committed,
      skipWrite: prepared.alreadyStarted && execution.alreadyPrepared,
    };
  });
}
