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
