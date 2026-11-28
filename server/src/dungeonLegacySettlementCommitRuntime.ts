import {
  prepareDungeonEncounterCommit,
} from './dungeonEncounterCommitRuntime.js';
import {
  prepareCommittedDungeonEncounterFinalization,
  type PreparedEncounterFinalization,
} from './dungeonPreparedEncounterFinalizationRuntime.js';
import { validateDungeonResultDeliveryOutbox } from './dungeonResultOutboxDelivery.js';
import {
  validateDungeonRunStore,
  type DungeonRunStore,
} from './dungeonRunState.js';
import type { PreparedDungeonEncounter } from './dungeonEncounterPreparation.js';
import type { DungeonResultOutbox } from './dungeonRunFinalizationRuntime.js';

type DungeonSettlementRuntime = {
  transactWithRecovery<T>(prepare: (recovery: { recovered: boolean; playersRecovered: boolean }) => {
    files: {
      players: Record<string, Record<string, unknown>>;
      dungeonRuns: DungeonRunStore;
      dungeonOutbox: DungeonResultOutbox;
    };
    result: T;
    skipWrite?: boolean;
  }): T;
};

export type CommittedLegacyDungeonSettlement = PreparedEncounterFinalization & {
  alreadyPrepared: boolean;
};

/**
 * Atomically publishes a legacy encounter's complete settlement.
 *
 * The already-calculated encounter is first attached to an in-memory run
 * snapshot, then finalized from that frozen snapshot. Player saves, the
 * terminal run/idempotency marker and pending result events are written by
 * one shared-WAL transaction. No durable active-run/start state is exposed.
 */
export function commitPreparedLegacyDungeonSettlement(input: {
  runtime: DungeonSettlementRuntime;
  runId: string;
  runs: DungeonRunStore;
  players: Record<string, Record<string, unknown>>;
  encounter: PreparedDungeonEncounter;
  now: number;
  outbox: DungeonResultOutbox;
}): CommittedLegacyDungeonSettlement {
  return input.runtime.transactWithRecovery(recovery => {
    if (recovery.recovered) {
      throw new Error('Shared state was recovered during dungeon settlement; reload player, run and outbox snapshots before retrying.');
    }
    const runs = validateDungeonRunStore(input.runs);
    const outbox = validateDungeonResultDeliveryOutbox(input.outbox);
    const current = runs[input.runId];
    if (!current) throw new Error('Cannot finalize a dungeon settlement without its run envelope.');

    let preparedRuns = runs;
    let alreadyPrepared = false;
    if (current.status === 'active') {
      const attached = prepareDungeonEncounterCommit({
        runId: input.runId,
        runs,
        encounter: input.encounter,
      });
      preparedRuns = attached.runs;
      alreadyPrepared = attached.alreadyPrepared;
    } else {
      const samePrepared = current.status === 'completed' &&
        current.preparedEncounter !== undefined &&
        JSON.stringify(current.preparedEncounter) === JSON.stringify(input.encounter);
      if (!samePrepared) {
        throw new Error('A terminal dungeon run cannot accept a different or missing prepared encounter.');
      }
      alreadyPrepared = true;
    }

    const finalized = prepareCommittedDungeonEncounterFinalization({
      runId: input.runId,
      runs: preparedRuns,
      now: input.now,
      outbox,
      events: input.encounter.outboxEvents?.map(event => ({
        eventId: event.eventId,
        runId: event.runId,
        playerId: event.playerId,
        messageType: event.messageType,
        payload: event.payload,
      })),
      players: input.players,
    });
    return {
      files: {
        players: finalized.players,
        dungeonRuns: finalized.runs,
        dungeonOutbox: finalized.outbox,
      },
      result: { ...finalized, alreadyPrepared },
      skipWrite: finalized.alreadyFinalized,
    };
  });
}
