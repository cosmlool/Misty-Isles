import {
  validateDungeonRunStore,
  type DungeonRunRecord,
  type DungeonRunStore,
} from './dungeonRunState.js';

export type DungeonStartPlayerSnapshot = Record<string, unknown> & {
  quests: string;
  battles: number;
};

export type PreparedDungeonRunStart = {
  run: DungeonRunRecord;
  players: Record<string, DungeonStartPlayerSnapshot>;
  runs: DungeonRunStore;
  alreadyStarted: boolean;
};

/**
 * Prepares the durable entry mutation. The caller must commit players and
 * dungeonRuns together through sharedStateRuntime.transact().
 */
export function prepareDungeonRunStart(input: {
  run: DungeonRunRecord;
  players: Record<string, DungeonStartPlayerSnapshot>;
  runs: DungeonRunStore;
  day: string;
  dailyLimit?: number;
}): PreparedDungeonRunStart {
  const { run } = input;
  const dailyLimit = input.dailyLimit ?? 3;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
      !Number.isInteger(dailyLimit) || dailyLimit < 1) {
    throw new Error('Invalid dungeon entry day or daily attempt limit.');
  }

  const currentRuns = validateDungeonRunStore(input.runs);
  const existingByRequest = Object.values(currentRuns).find(entry => entry.requestId === run.requestId);
  if (existingByRequest) {
    const sameRun = existingByRequest.runId === run.runId &&
      existingByRequest.dungeonId === run.dungeonId &&
      existingByRequest.groupId === run.groupId &&
      existingByRequest.leaderId === run.leaderId &&
      JSON.stringify(existingByRequest.participantIds) === JSON.stringify(run.participantIds);
    if (!sameRun) throw new Error('Dungeon request ID is already bound to a different run.');
    return {
      run: existingByRequest,
      players: input.players,
      runs: currentRuns,
      alreadyStarted: true,
    };
  }

  if (Object.prototype.hasOwnProperty.call(currentRuns, run.runId)) {
    throw new Error('Dungeon run ID already exists.');
  }
  const validatedNewRun = validateDungeonRunStore({ [run.runId]: run })[run.runId];
  if (validatedNewRun.participantIds.some(id => !input.players[id])) {
    throw new Error('Every dungeon participant must have a player snapshot.');
  }
  const overlap = Object.values(currentRuns).find(existing =>
    existing.status === 'active' &&
    existing.participantIds.some(id => validatedNewRun.participantIds.includes(id)));
  if (overlap) throw new Error('A dungeon participant already belongs to an active run.');

  const nextPlayers = { ...input.players };
  for (const playerId of validatedNewRun.participantIds) {
    const player = nextPlayers[playerId];
    let quests: unknown;
    try {
      quests = JSON.parse(player.quests);
    } catch {
      throw new Error(`Invalid quest snapshot for dungeon participant ${playerId}.`);
    }
    if (!quests || typeof quests !== 'object' || Array.isArray(quests)) {
      throw new Error(`Invalid quest snapshot for dungeon participant ${playerId}.`);
    }
    const nextQuests = { ...(quests as Record<string, unknown>) };
    if (nextQuests.dungeonDay !== input.day) {
      nextQuests.dungeonDay = input.day;
      nextQuests.dungeonRuns = 0;
    }
    const used = Number(nextQuests.dungeonRuns || 0);
    const battles = Number(player.battles || 0);
    if (!Number.isInteger(battles) || battles < 0) {
      throw new Error(`Invalid battle counter for dungeon participant ${playerId}.`);
    }
    if (!Number.isInteger(used) || used < 0 || used >= dailyLimit) {
      throw new Error(`Daily dungeon attempts exhausted for participant ${playerId}.`);
    }
    nextQuests.dungeonRuns = used + 1;
    nextPlayers[playerId] = {
      ...player,
      quests: JSON.stringify(nextQuests),
      battles: battles + 1,
    };
  }

  const nextRuns = validateDungeonRunStore({
    ...currentRuns,
    [validatedNewRun.runId]: validatedNewRun,
  });
  return {
    run: validatedNewRun,
    players: nextPlayers,
    runs: nextRuns,
    alreadyStarted: false,
  };
}
