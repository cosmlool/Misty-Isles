import {
  reviveDungeonParticipant,
  type DungeonRunRecord,
} from './dungeonRunState.js';
import { consumeResurrectionScroll, RESURRECTION_SCROLL_ID } from './resurrectionScrolls.js';

export type DungeonPlayerSnapshot = Record<string, unknown> & {
  inventory: string;
};

export type PreparedDungeonRevival = {
  run: DungeonRunRecord;
  players: Record<string, DungeonPlayerSnapshot>;
};

/**
 * Prepares the two halves of a resurrection mutation for one shared-WAL commit.
 * Call this inside sharedStateRuntime.transact and persist both returned
 * snapshots (players and dungeonRuns) in the same journal entry.
 */
export function prepareDungeonRevival(input: {
  run: DungeonRunRecord;
  players: Record<string, DungeonPlayerSnapshot>;
  rescuerId: string;
  targetId: string;
  reviveHealth: number;
  now: number;
}): PreparedDungeonRevival {
  const rescuer = input.players[input.rescuerId];
  if (!rescuer) throw new Error('Rescuer player snapshot is missing.');

  let inventory: unknown;
  try {
    inventory = JSON.parse(rescuer.inventory);
  } catch {
    throw new Error('Rescuer inventory snapshot is invalid; resurrection cancelled.');
  }
  if (!Array.isArray(inventory) || inventory.some(id => typeof id !== 'string')) {
    throw new Error('Rescuer inventory snapshot is invalid; resurrection cancelled.');
  }

  const availableScrolls = inventory.filter(id => id === RESURRECTION_SCROLL_ID).length;
  const transition = reviveDungeonParticipant(input.run, {
    rescuerId: input.rescuerId,
    targetId: input.targetId,
    availableScrolls,
    reviveHealth: input.reviveHealth,
    now: input.now,
  });
  const nextInventory = consumeResurrectionScroll(inventory);

  return {
    run: transition.run,
    players: {
      ...input.players,
      [input.rescuerId]: {
        ...rescuer,
        inventory: JSON.stringify(nextInventory),
      },
    },
  };
}
