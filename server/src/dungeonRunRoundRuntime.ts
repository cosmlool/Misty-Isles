import {
  resolveNextDungeonRunRound,
  validateDungeonRunStore,
  type DungeonRunStore,
} from './dungeonRunState.js';

type DungeonRoundRuntime = {
  transact<T>(prepare: (recovered: boolean) => {
    files: { players: Record<string, Record<string, unknown>>; dungeonRuns: DungeonRunStore };
    result: T;
    skipWrite?: boolean;
  }): T;
};

export type CommittedDungeonRound = {
  run: DungeonRunStore[string];
  players: Record<string, Record<string, unknown>>;
  alreadyAdvanced: false;
};

/**
 * Commits encounter progress and the matching player HP snapshots in one
 * shared-WAL transaction. expectedRoundIndex prevents a stale retry from
 * applying the same round twice. Callers must reload both snapshots after
 * recovery before retrying.
 */
export function commitDungeonRunRound(input: {
  runtime: DungeonRoundRuntime;
  runId: string;
  expectedRoundIndex: number;
  runs: DungeonRunStore;
  players: Record<string, Record<string, unknown>>;
  now: number;
}): CommittedDungeonRound {
  if (!input.runId || !Number.isInteger(input.expectedRoundIndex) ||
      input.expectedRoundIndex < 0 || !Number.isFinite(input.now)) {
    throw new Error('Invalid dungeon round commit request.');
  }

  return input.runtime.transact(recovered => {
    if (recovered) {
      throw new Error('Shared state was recovered during dungeon round commit; reload player and dungeon run snapshots before retrying.');
    }
    const currentRuns = validateDungeonRunStore(input.runs);
    const current = currentRuns[input.runId];
    if (!current) throw new Error('Dungeon run does not exist.');
    if (current.status !== 'active') throw new Error('Cannot commit a round for a terminal dungeon run.');
    if (current.roundIndex !== input.expectedRoundIndex) {
      throw new Error('Dungeon round snapshot is stale; reload the current run before advancing.');
    }

    const next = resolveNextDungeonRunRound(current, input.now);
    const nextPlayers = { ...input.players };
    for (const playerId of next.participantIds) {
      const player = nextPlayers[playerId];
      if (!player || !Number.isFinite(player.health)) {
        throw new Error(`Missing or invalid player snapshot for dungeon participant ${playerId}.`);
      }
      nextPlayers[playerId] = { ...player, health: next.participants[playerId].health };
    }
    const nextRuns = validateDungeonRunStore({ ...currentRuns, [input.runId]: next });
    return {
      files: { players: nextPlayers, dungeonRuns: nextRuns },
      result: { run: next, players: nextPlayers, alreadyAdvanced: false as const },
    };
  });
}
