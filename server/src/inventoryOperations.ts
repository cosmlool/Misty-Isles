export type EquipmentMap = Record<string, unknown>;

const EQUIPMENT_SLOTS = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'cloak', 'amulet'];

/**
 * Inventory stores all owned copies, while equipment points at an item ID.
 * Removing one duplicate must not unequip the remaining equipped copy.
 */
export function removeInventoryCopy(
  inventory: string[],
  equipment: EquipmentMap,
  index: number,
): { itemId: string; inventory: string[]; equipment: EquipmentMap } {
  if (!Array.isArray(inventory) || inventory.some(item => typeof item !== 'string')) {
    throw new Error('Inventory is invalid.');
  }
  if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) {
    throw new Error('Equipment is invalid.');
  }
  if (!Number.isInteger(index) || index < 0 || index >= inventory.length) {
    throw new Error('Item is not in the inventory.');
  }

  const nextInventory = [...inventory];
  const itemId = nextInventory.splice(index, 1)[0];
  const nextEquipment = { ...equipment };
  if (!nextInventory.includes(itemId)) {
    for (const slot of EQUIPMENT_SLOTS) {
      if (nextEquipment[slot] === itemId) nextEquipment[slot] = '';
    }
  }
  return { itemId, inventory: nextInventory, equipment: nextEquipment };
}

/** True only when removing this item would leave no owned copy for its equipment slot. */
export function isLastEquippedCopy(
  inventory: string[],
  equipment: EquipmentMap,
  itemId: string,
): boolean {
  return Object.values(equipment).includes(itemId)
    && inventory.filter(item => item === itemId).length <= 1;
}

/** Whether the character still owns any copy of an item type after a removal. */
export function ownsItemCopy(
  inventory: string[],
  equipment: EquipmentMap,
  itemId: string,
): boolean {
  return inventory.includes(itemId) || Object.values(equipment).includes(itemId);
}

/** Remove already-owned unique item IDs from a reward pool. */
export function filterAvailableUniqueItems(
  itemIds: string[],
  uniqueItemIds: ReadonlySet<string>,
  inventory: string[],
  equipment: EquipmentMap,
): string[] {
  return itemIds.filter(itemId => !uniqueItemIds.has(itemId) || !ownsItemCopy(inventory, equipment, itemId));
}


/**
 * Validate a client action against the exact inventory snapshot shown to that client.
 * Requiring the stack count prevents a replayed index action from consuming the next
 * adjacent copy after the first removal.
 */
export function validateInventoryStackAction(
  inventory: string[],
  index: number,
  itemId: unknown,
  expectedCount: unknown,
): boolean {
  if (!Array.isArray(inventory) || inventory.some(item => typeof item !== 'string')) {
    throw new Error('Inventory is invalid.');
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= inventory.length
    || typeof itemId !== 'string' || itemId.length === 0
    || !Number.isSafeInteger(expectedCount) || Number(expectedCount) < 1) {
    return false;
  }
  return inventory[index] === itemId
    && inventory.filter(item => item === itemId).length === expectedCount;
}
