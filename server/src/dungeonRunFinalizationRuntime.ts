import {
  finishDungeonRun,
  validateDungeonRunStore,
  type DungeonRunRecord,
  type DungeonRunStore,
} from './dungeonRunState.js';

export type DungeonFinalizationOutcome =
  NonNullable<DungeonRunRecord['terminalResult']>['outcome'];

export type DungeonFinalizationPlayerSnapshot = Record<string, unknown>;

export type PreparedDungeonFinalization = {
  run: DungeonRunRecord;
  players: Record<string, DungeonFinalizationPlayerSnapshot>;
  runs: DungeonRunStore;
  claimId: string;
  alreadyFinalized: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Prepares a terminal dungeon result together with the complete post-reward
 * player snapshots. The caller must calculate rewards using the existing game
 * rules, then commit both files in one shared-WAL transaction.
 *
 * A terminal run is the durable idempotency marker: the same outcome is a
 * no-op, while a conflicting outcome or stale run snapshot is rejected.
 */
export function prepareDungeonRunFinalization(input: {
  runId: string;
  expectedRoundIndex: number;
  expectedUpdatedAt: number;
  outcome: DungeonFinalizationOutcome;
  players: Record<string, DungeonFinalizationPlayerSnapshot>;
  runs: DungeonRunStore;
  now: number;
}): PreparedDungeonFinalization {
  if (!input.runId || !Number.isInteger(input.expectedRoundIndex) ||
      input.expectedRoundIndex < 0 || !Number.isFinite(input.expectedUpdatedAt) ||
      !Number.isFinite(input.now)) {
    throw new Error('Invalid dungeon finalization request.');
  }
  const currentRuns = validateDungeonRunStore(input.runs);
  const current = currentRuns[input.runId];
  if (!current) throw new Error('Dungeon run does not exist.');
  const claimId = `dungeon:${current.runId}:${current.requestId}:${input.outcome}`;

  if (current.status !== 'active') {
    if (current.terminalResult?.outcome !== input.outcome) {
      throw new Error('Dungeon run has already been finalized with a different outcome.');
    }
    if (current.terminalResult.claimId !== undefined && current.terminalResult.claimId !== claimId) {
      throw new Error('Dungeon finalization claim does not match the durable run result.');
    }
    return {
      run: current,
      players: input.players,
      runs: currentRuns,
      claimId,
      alreadyFinalized: true,
    };
  }

  if (current.roundIndex !== input.expectedRoundIndex ||
      current.updatedAt !== input.expectedUpdatedAt) {
    throw new Error('Dungeon finalization snapshot is stale; reload the current run and players.');
  }
  if ((input.outcome === 'win' || input.outcome === 'loss') && current.roundPlan &&
      current.roundPlan.nextRoundIndex !== current.roundPlan.totalRounds) {
    throw new Error('Cannot finalize a dungeon run while planned combat rounds remain unresolved.');
  }
  for (const playerId of current.participantIds) {
    if (!isRecord(input.players[playerId])) {
      throw new Error(`Missing player snapshot for dungeon participant ${playerId}.`);
    }
  }

  const nextRun = finishDungeonRun(current, input.outcome, input.now);
  const nextRuns = validateDungeonRunStore({
    ...currentRuns,
    [input.runId]: nextRun,
  });
  return {
    run: nextRun,
    players: input.players,
    runs: nextRuns,
    claimId,
    alreadyFinalized: false,
  };
}

type DungeonFinalizationRuntime = {
  transact<T>(prepare: (recovered: boolean) => {
    files: { players: Record<string, DungeonFinalizationPlayerSnapshot>; dungeonRuns: DungeonRunStore };
    result: T;
    skipWrite?: boolean;
  }): T;
};

/**
 * Commits terminal run state and post-reward player snapshots together.
 * Callers must reload both snapshots after WAL recovery before retrying.
 */
export function commitDungeonRunFinalization(input: {
  runtime: DungeonFinalizationRuntime;
  runId: string;
  expectedRoundIndex: number;
  expectedUpdatedAt: number;
  outcome: DungeonFinalizationOutcome;
  players: Record<string, DungeonFinalizationPlayerSnapshot>;
  runs: DungeonRunStore;
  now: number;
}): PreparedDungeonFinalization {
  return input.runtime.transact(recovered => {
    if (recovered) {
      throw new Error('Shared state was recovered during dungeon finalization; reload player and dungeon run snapshots before retrying.');
    }
    const prepared = prepareDungeonRunFinalization(input);
    return {
      files: {
        players: prepared.players,
        dungeonRuns: prepared.runs,
      },
      result: prepared,
      skipWrite: prepared.alreadyFinalized,
    };
  });
}
