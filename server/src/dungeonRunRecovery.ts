import { validateDungeonRunStore, type DungeonRunRecord, type DungeonRunStore } from './dungeonRunState.js';

export type DungeonRunRecoveryView = {
  runId: string; dungeonId: string; leaderId: string; isLeader: boolean;
  roundIndex: number; totalRounds: number | null; startedAt: number; updatedAt: number;
  participants: Array<{ playerId: string; status: DungeonRunRecord['participants'][string]['status']; health: number; maxHealth: number }>;
};

export function findActiveDungeonRunForParticipant(runs: DungeonRunStore, playerId: string): DungeonRunRecord | null {
  if (!playerId) return null;
  const validated = validateDungeonRunStore(runs);
  const matches = Object.values(validated).filter(run => run.status === 'active' && run.participantIds.includes(playerId));
  if (matches.length > 1) throw new Error(`Player ${playerId} belongs to multiple active dungeon runs.`);
  return matches[0] || null;
}

export function createDungeonRunRecoveryView(run: DungeonRunRecord | null, playerId: string): DungeonRunRecoveryView | null {
  if (!run) return null;
  if (run.status !== 'active' || !run.participantIds.includes(playerId)) throw new Error('Dungeon recovery view is only available to an active run participant.');
  return {
    runId: run.runId, dungeonId: run.dungeonId, leaderId: run.leaderId, isLeader: run.leaderId === playerId,
    roundIndex: run.roundIndex, totalRounds: run.roundPlan?.totalRounds ?? null, startedAt: run.startedAt, updatedAt: run.updatedAt,
    participants: run.participantIds.map(id => ({ playerId: id, status: run.participants[id].status, health: run.participants[id].health, maxHealth: run.participants[id].maxHealth })),
  };
}

/**
 * Blocks a new party entry when any frozen roster member already belongs to an
 * active durable run. Each participant is checked independently so a member
 * who is not the requesting leader cannot be pulled into overlapping runs.
 */
export function findActiveDungeonRunForParticipants(
  runs: DungeonRunStore,
  playerIds: string[],
): { playerId: string; run: DungeonRunRecord } | null {
  if (!Array.isArray(playerIds) || playerIds.some(id => typeof id !== 'string' || !id) ||
      new Set(playerIds).size !== playerIds.length) {
    throw new Error('Dungeon entry participant IDs must be unique non-empty strings.');
  }
  const validated = validateDungeonRunStore(runs);
  for (const playerId of playerIds) {
    const run = findActiveDungeonRunForParticipant(validated, playerId);
    if (run) return { playerId, run };
  }
  return null;
}


/**
 * Validates the global active-run roster invariant during startup. A player
 * must never be restored into two active runs, even if no client has joined yet.
 */
export function assertNoOverlappingActiveDungeonRuns(runs: DungeonRunStore): void {
  const validated = validateDungeonRunStore(runs);
  const ownerByPlayer = new Map<string, string>();
  for (const run of Object.values(validated)) {
    if (run.status !== 'active') continue;
    for (const playerId of run.participantIds) {
      const previousRunId = ownerByPlayer.get(playerId);
      if (previousRunId) {
        throw new Error(`Player ${playerId} belongs to overlapping active dungeon runs ${previousRunId} and ${run.runId}.`);
      }
      ownerByPlayer.set(playerId, run.runId);
    }
  }
}
