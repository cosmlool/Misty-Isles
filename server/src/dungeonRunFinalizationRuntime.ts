import {
  finishDungeonRun,
  validateDungeonRunStore,
  type DungeonRunRecord,
  type DungeonRunStore,
} from './dungeonRunState.js';

export type DungeonFinalizationOutcome =
  NonNullable<DungeonRunRecord['terminalResult']>['outcome'];

export type DungeonFinalizationPlayerSnapshot = Record<string, unknown>;

export type DungeonResultOutboxEvent = {
  eventId: string;
  runId: string;
  playerId: string;
  messageType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered';
  createdAt: number;
  deliveredAt?: number;
};
export type DungeonResultOutbox = Record<string, DungeonResultOutboxEvent>;

export type PreparedDungeonFinalization = {
  run: DungeonRunRecord;
  players: Record<string, DungeonFinalizationPlayerSnapshot>;
  runs: DungeonRunStore;
  outbox: DungeonResultOutbox;
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
  outbox?: DungeonResultOutbox;
  events?: Array<Omit<DungeonResultOutboxEvent, 'status' | 'createdAt' | 'deliveredAt'>>;
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
  const currentOutbox = input.outbox || {};
  if (!isRecord(currentOutbox)) throw new Error('Dungeon result outbox must be an object keyed by event ID.');
  const nextOutbox: DungeonResultOutbox = { ...currentOutbox };

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
      outbox: currentOutbox,
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

  const events = input.events || [];
  const eventIds = new Set<string>();
  for (const event of events) {
    if (!event || event.runId !== current.runId || !current.participantIds.includes(event.playerId) ||
        !event.eventId || !event.eventId.startsWith(`dungeon:${current.runId}:`) ||
        !event.messageType || !isRecord(event.payload) || eventIds.has(event.eventId)) {
      throw new Error('Dungeon result outbox event is invalid or does not belong to this run.');
    }
    eventIds.add(event.eventId);
    const existing = nextOutbox[event.eventId];
    if (existing) {
      if (existing.runId !== event.runId || existing.playerId !== event.playerId ||
          existing.messageType !== event.messageType || JSON.stringify(existing.payload) !== JSON.stringify(event.payload)) {
        throw new Error('Dungeon result outbox event ID is already bound to a different payload.');
      }
      continue;
    }
    nextOutbox[event.eventId] = {
      ...event,
      status: 'pending',
      createdAt: input.now,
    };
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
    outbox: nextOutbox,
    claimId,
    alreadyFinalized: false,
  };
}

type DungeonFinalizationRuntime = {
  transact<T>(prepare: (recovered: boolean) => {
    files: { players?: Record<string, DungeonFinalizationPlayerSnapshot>; dungeonRuns?: DungeonRunStore; dungeonOutbox?: DungeonResultOutbox };
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
  outbox?: DungeonResultOutbox;
  events?: Array<Omit<DungeonResultOutboxEvent, 'status' | 'createdAt' | 'deliveredAt'>>;
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
        dungeonOutbox: prepared.outbox,
      },
      result: prepared,
      skipWrite: prepared.alreadyFinalized,
    };
  });
}


/**
 * Marks a result event delivered only after the transport accepts the send.
 * Delivery is at-least-once: a process crash between send and acknowledgement
 * can replay the event, so consumers should deduplicate by eventId.
 */
export function markDungeonResultEventDelivered(input: {
  runtime: DungeonFinalizationRuntime;
  outbox: DungeonResultOutbox;
  eventId: string;
  now: number;
}): DungeonResultOutbox {
  if (!input.eventId || !Number.isFinite(input.now)) throw new Error('Invalid dungeon outbox acknowledgement.');
  return input.runtime.transact(recovered => {
    if (recovered) throw new Error('Shared state was recovered during dungeon outbox acknowledgement; reload the outbox before retrying.');
    const current = input.outbox[input.eventId];
    if (!current) throw new Error('Dungeon result outbox event does not exist.');
    if (current.status === 'delivered') {
      return { files: { dungeonOutbox: input.outbox }, result: input.outbox, skipWrite: true };
    }
    const next = {
      ...input.outbox,
      [input.eventId]: { ...current, status: 'delivered' as const, deliveredAt: input.now },
    };
    return { files: { dungeonOutbox: next }, result: next };
  });
}
