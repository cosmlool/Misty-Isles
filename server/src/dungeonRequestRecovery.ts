import {
  validateDungeonRunStore,
  type DungeonRunRecord,
  type DungeonRunStore,
} from './dungeonRunState.js';

export type DungeonRequestRecoveryIdentity = {
  requestId: string;
  dungeonId: string;
  groupId: string;
  leaderId: string;
  participantIds: string[];
};

export type DungeonRequestRecovery =
  | { kind: 'not-found' }
  | { kind: 'prepare-encounter'; run: DungeonRunRecord }
  | { kind: 'finalize-committed-encounter'; run: DungeonRunRecord }
  | { kind: 'replay-terminal-result'; run: DungeonRunRecord };

/**
 * Routes a repeated live request to its durable state. This function never
 * mutates players, charges attempts, rolls drops, or recalculates combat.
 */
export function resolveDungeonRequestRecovery(input: {
  identity: DungeonRequestRecoveryIdentity;
  runs: DungeonRunStore;
}): DungeonRequestRecovery {
  const { identity } = input;
  if (!identity.requestId || !identity.dungeonId || !identity.leaderId ||
      typeof identity.groupId !== 'string' || !Array.isArray(identity.participantIds) ||
      identity.participantIds.length < 1 || identity.participantIds.length > 3 ||
      new Set(identity.participantIds).size !== identity.participantIds.length ||
      !identity.participantIds.includes(identity.leaderId) ||
      identity.participantIds.some(id => typeof id !== 'string' || !id)) {
    throw new Error('Invalid dungeon request recovery identity.');
  }

  const runs = validateDungeonRunStore(input.runs);
  const matches = Object.values(runs).filter(run => run.requestId === identity.requestId);
  if (matches.length > 1) {
    throw new Error('Dungeon request ID is bound to multiple durable runs.');
  }
  const run = matches[0];
  if (!run) return { kind: 'not-found' };

  const sameIdentity = run.dungeonId === identity.dungeonId &&
    run.groupId === identity.groupId &&
    run.leaderId === identity.leaderId &&
    JSON.stringify(run.participantIds) === JSON.stringify(identity.participantIds);
  if (!sameIdentity) {
    throw new Error('Dungeon request ID is already bound to a different run identity.');
  }

  if (run.status !== 'active') return { kind: 'replay-terminal-result', run };
  if (run.preparedEncounter) return { kind: 'finalize-committed-encounter', run };
  return { kind: 'prepare-encounter', run };
}
