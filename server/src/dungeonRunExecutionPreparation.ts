import {
  createDungeonRoundPlan,
  validateDungeonRunStore,
  type DungeonRunRecord,
  type DungeonRunStore,
} from './dungeonRunState.js';
import {
  validatePreparedDungeonEncounter,
  type PreparedDungeonEncounter,
} from './dungeonEncounterPreparation.js';

export type PreparedDungeonRunExecution = {
  run: DungeonRunRecord;
  runs: DungeonRunStore;
  alreadyPrepared: boolean;
};

function samePlanDefinition(
  current: DungeonRunRecord['roundPlan'],
  expected: NonNullable<DungeonRunRecord['roundPlan']>,
): boolean {
  return Boolean(current) &&
    current!.totalRounds === expected.totalRounds &&
    JSON.stringify(current!.bossDamageByRound) === JSON.stringify(expected.bossDamageByRound) &&
    JSON.stringify(current!.incomingDamageByRound) === JSON.stringify(expected.incomingDamageByRound);
}

/**
 * Freezes the already-calculated encounter and derives its resumable round
 * schedule without recalculating combat, healing, rewards, or random outcomes.
 * Call this before the atomic entry transaction so the active run, attempt
 * charge, and complete execution plan can be committed together.
 */
export function prepareDungeonRunExecution(input: {
  runId: string;
  runs: DungeonRunStore;
  encounter: PreparedDungeonEncounter;
}): PreparedDungeonRunExecution {
  if (!input.runId) throw new Error('A dungeon run ID is required to prepare execution.');
  const runs = validateDungeonRunStore(input.runs);
  const current = runs[input.runId];
  if (!current) throw new Error('Cannot prepare execution for a missing dungeon run.');
  if (current.status !== 'active') throw new Error('Cannot prepare execution for a terminal dungeon run.');

  const encounter = validatePreparedDungeonEncounter(input.encounter);
  if (encounter.runId !== current.runId || encounter.requestId !== current.requestId ||
      encounter.dungeonId !== current.dungeonId || encounter.bossId !== current.encounter.bossId ||
      JSON.stringify(encounter.participantIds) !== JSON.stringify(current.participantIds) ||
      encounter.preparedAt < current.startedAt) {
    throw new Error('Prepared encounter identity does not match the active dungeon run.');
  }

  const totalBossDamage = encounter.combat.damageByParticipant.reduce((sum, damage) => sum + damage, 0);
  const totalIncomingDamageByParticipant = Object.fromEntries(
    current.participantIds.map((playerId, index) => [playerId, encounter.combat.incoming[index]]),
  );
  const expectedPlan = createDungeonRoundPlan({
    totalRounds: encounter.combat.rounds,
    totalBossDamage,
    totalIncomingDamageByParticipant,
  });

  for (const playerId of current.participantIds) {
    const participant = current.participants[playerId];
    const preparedParticipant = encounter.participants[playerId];
    const playerSnapshot = encounter.playerSnapshots[playerId];
    if (!participant || preparedParticipant.hpBefore !== participant.health ||
        preparedParticipant.hpAfter > participant.maxHealth ||
        (playerSnapshot.id !== undefined && playerSnapshot.id !== playerId)) {
      throw new Error(`Prepared encounter participant snapshot is stale or exceeds the run bounds: ${playerId}.`);
    }
  }

  if (current.preparedEncounter) {
    if (JSON.stringify(current.preparedEncounter) !== JSON.stringify(encounter) ||
        !samePlanDefinition(current.roundPlan, expectedPlan)) {
      throw new Error('A different or incomplete execution plan is already committed for this dungeon run.');
    }
    return { run: current, runs, alreadyPrepared: true };
  }

  if (current.roundIndex !== 0 || current.roundPlan) {
    throw new Error('Dungeon execution must be prepared before the first round is committed.');
  }

  const nextRun: DungeonRunRecord = {
    ...current,
    updatedAt: Math.max(current.updatedAt, encounter.preparedAt),
    roundPlan: expectedPlan,
    preparedEncounter: encounter,
  };
  const nextRuns = validateDungeonRunStore({ ...runs, [input.runId]: nextRun });
  return { run: nextRun, runs: nextRuns, alreadyPrepared: false };
}
