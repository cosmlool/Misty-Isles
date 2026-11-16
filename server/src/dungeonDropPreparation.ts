export type DungeonDropDefinition = { id: string; chance?: number };
export type DungeonDropAllocation = { itemId: string; recipientId: string };

/** Rolls optional drops in source order. The caller supplies the RNG so the
 * legacy handler keeps control of the exact random stream and can test it. */
export function rollDungeonDropIds(
  guaranteedItemId: string,
  optionalDrops: DungeonDropDefinition[],
  dropBonus: number,
  roll: () => number,
): string[] {
  if (!guaranteedItemId || !Array.isArray(optionalDrops) ||
      !Number.isFinite(dropBonus) || typeof roll !== 'function') {
    throw new Error('Invalid dungeon drop preparation input.');
  }
  const drops = [guaranteedItemId];
  for (const drop of optionalDrops) {
    if (!drop || typeof drop.id !== 'string' || !drop.id || drop.id === guaranteedItemId) continue;
    if (roll() < Math.min(0.95, Number(drop.chance || 0) * (1 + dropBonus))) drops.push(drop.id);
  }
  return drops;
}

/** Assigns every rolled item exactly once, preserving item order and the
 * caller-provided recipient RNG sequence. */
export function allocateDungeonDropRecipients(
  itemIds: string[],
  participantIds: string[],
  chooseRecipientIndex: () => number,
): DungeonDropAllocation[] {
  if (!Array.isArray(itemIds) || itemIds.some(id => typeof id !== 'string' || !id) ||
      !Array.isArray(participantIds) || participantIds.length < 1 || participantIds.length > 3 ||
      participantIds.some(id => typeof id !== 'string' || !id) ||
      new Set(participantIds).size !== participantIds.length ||
      typeof chooseRecipientIndex !== 'function') {
    throw new Error('Invalid dungeon drop recipient allocation input.');
  }
  return itemIds.map(itemId => {
    const index = chooseRecipientIndex();
    if (!Number.isInteger(index) || index < 0 || index >= participantIds.length) {
      throw new Error('Dungeon drop recipient index is outside the participant roster.');
    }
    return { itemId, recipientId: participantIds[index] };
  });
}
