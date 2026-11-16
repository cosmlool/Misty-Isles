import {
  validatePreparedDungeonEncounter,
  type PreparedDungeonEncounter,
} from './dungeonEncounterPreparation.js';
import {
  prepareDungeonRunFinalization,
  type DungeonFinalizationOutcome,
  type DungeonResultOutbox,
  type PreparedDungeonFinalization,
} from './dungeonRunFinalizationRuntime.js';
import {
  validateDungeonRunStore,
  type DungeonRunStore,
} from './dungeonRunState.js';

export type PreparedEncounterFinalization = PreparedDungeonFinalization & {
  encounter: PreparedDungeonEncounter;
};

/**
 * Finalizes exclusively from the encounter snapshot already committed to the
 * run. No combat calculation, drop roll, recipient selection, or reward
 * calculation is performed here.
 */
export function prepareCommittedDungeonEncounterFinalization(input: {
  runId: string;
  runs: DungeonRunStore;
  now: number;
  outbox?: DungeonResultOutbox;
  events?: Parameters<typeof prepareDungeonRunFinalization>[0]['events'];
}): PreparedEncounterFinalization {
  if (!input.runId || !Number.isFinite(input.now)) {
    throw new Error('Invalid committed encounter finalization request.');
  }
  const runs = validateDungeonRunStore(input.runs);
  const current = runs[input.runId];
  if (!current) throw new Error('Dungeon run does not exist.');
  if (!current.preparedEncounter) {
    throw new Error('Dungeon run has no committed prepared encounter to finalize.');
  }
  const encounter = validatePreparedDungeonEncounter(current.preparedEncounter);
  const outcome: DungeonFinalizationOutcome = encounter.combat.win ? 'win' : 'loss';
  const prepared = prepareDungeonRunFinalization({
    runId: current.runId,
    expectedRoundIndex: current.roundIndex,
    expectedUpdatedAt: current.updatedAt,
    outcome,
    players: encounter.playerSnapshots,
    runs,
    now: input.now,
    outbox: input.outbox,
    events: input.events,
  });
  return { ...prepared, encounter };
}

type CommittedEncounterFinalizationRuntime = {
  transact<T>(prepare: (recovered: boolean) => {
    files: {
      players?: Record<string, Record<string, unknown>>;
      dungeonRuns?: DungeonRunStore;
      dungeonOutbox?: DungeonResultOutbox;
    };
    result: T;
    skipWrite?: boolean;
  }): T;
};

/** Atomically writes the frozen player snapshots, terminal run marker and outbox. */
export function commitCommittedDungeonEncounterFinalization(input: {
  runtime: CommittedEncounterFinalizationRuntime;
  runId: string;
  runs: DungeonRunStore;
  now: number;
  outbox?: DungeonResultOutbox;
  events?: Parameters<typeof prepareDungeonRunFinalization>[0]['events'];
}): PreparedEncounterFinalization {
  return input.runtime.transact(recovered => {
    if (recovered) {
      throw new Error('Shared state was recovered during committed encounter finalization; reload run and outbox snapshots before retrying.');
    }
    const prepared = prepareCommittedDungeonEncounterFinalization(input);
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
