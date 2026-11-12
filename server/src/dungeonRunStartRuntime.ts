import type { SharedStateSnapshot } from './sharedStateTransactions.js';
import {
  prepareDungeonRunStart,
  type DungeonStartPlayerSnapshot,
  type PreparedDungeonRunStart,
} from './dungeonRunStartTransaction.js';
import type { DungeonRunRecord, DungeonRunStore } from './dungeonRunState.js';

type DungeonEntryRuntime = {
  transact<T>(prepare: (recovered: boolean) => {
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
}): PreparedDungeonRunStart {
  return input.runtime.transact(recovered => {
    if (recovered) {
      throw new Error('Shared state was recovered during dungeon entry; reload player and run snapshots before retrying.');
    }
    const prepared = prepareDungeonRunStart({
      run: input.run,
      players: input.players,
      runs: input.runs,
      day: input.day,
      dailyLimit: input.dailyLimit,
    });
    return {
      files: { players: prepared.players, dungeonRuns: prepared.runs },
      result: prepared,
      skipWrite: prepared.alreadyStarted,
    };
  });
}
