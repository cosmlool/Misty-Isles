import {
  resolveNextDungeonRunRound,
  validateDungeonRunStore,
  type DungeonRunStore,
} from './dungeonRunState.js';

type DungeonRoundRuntime = {
  transact<T>(prepare: (recovered: boolean) => {
    files: { dungeonRuns: DungeonRunStore };
    result: T;
    skipWrite?: boolean;
  }): T;
};

export type CommittedDungeonRound = {
  run: DungeonRunStore[string];
  alreadyAdvanced: false;
};

/**
 * Commits exactly one preplanned round through the shared WAL.
 *
 * expectedRoundIndex is a compare-and-swap guard: after a crash/retry the
 * caller must reload the durable run instead of applying the same round twice.
 * Player HP/rewards are deliberately not mutated here; this boundary commits
 * only the authoritative encounter snapshot.
 */
export function commitDungeonRunRound(input: {
  runtime: DungeonRoundRuntime;
  runId: string;
  expectedRoundIndex: number;
  runs: DungeonRunStore;
  now: number;
}): CommittedDungeonRound {
  if (!input.runId || !Number.isInteger(input.expectedRoundIndex) ||
      input.expectedRoundIndex < 0 || !Number.isFinite(input.now)) {
    throw new Error('Invalid dungeon round commit request.');
  }

  return input.runtime.transact(recovered => {
    if (recovered) {
      throw new Error('Shared state was recovered during dungeon round commit; reload the dungeon run before retrying.');
    }
    const currentRuns = validateDungeonRunStore(input.runs);
    const current = currentRuns[input.runId];
    if (!current) throw new Error('Dungeon run does not exist.');
    if (current.status !== 'active') throw new Error('Cannot commit a round for a terminal dungeon run.');
    if (current.roundIndex !== input.expectedRoundIndex) {
      throw new Error('Dungeon round snapshot is stale; reload the current run before advancing.');
    }

    const next = resolveNextDungeonRunRound(current, input.now);
    const nextRuns = validateDungeonRunStore({ ...currentRuns, [input.runId]: next });
    return {
      files: { dungeonRuns: nextRuns },
      result: { run: next, alreadyAdvanced: false as const },
    };
  });
}
