export const RESURRECTION_SCROLL_ID = 'resurrection_scroll';
export const RESURRECTION_SCROLL_PRICE = 100;
export const RESURRECTION_SCROLL_MAX_INVENTORY = 2;

export type ResurrectionScrollPurchase = {
  inventory: string[];
  crystals: number;
};

export function purchaseResurrectionScroll(input: {
  inventory: string[];
  crystals: number;
  inCity: boolean;
  inActiveDungeon: boolean;
}): ResurrectionScrollPurchase {
  if (!input.inCity) throw new Error('Resurrection scrolls can only be purchased in a city.');
  if (input.inActiveDungeon) throw new Error('Cannot purchase items during an active dungeon run.');
  const owned = input.inventory.filter(id => id === RESURRECTION_SCROLL_ID).length;
  if (owned >= RESURRECTION_SCROLL_MAX_INVENTORY) {
    throw new Error('A participant can carry at most two resurrection scrolls.');
  }
  if (!Number.isFinite(input.crystals) || input.crystals < RESURRECTION_SCROLL_PRICE) {
    throw new Error('Not enough crystals for a resurrection scroll.');
  }
  return {
    inventory: [...input.inventory, RESURRECTION_SCROLL_ID],
    crystals: input.crystals - RESURRECTION_SCROLL_PRICE,
  };
}

export function consumeResurrectionScroll(inventory: string[]): string[] {
  const index = inventory.indexOf(RESURRECTION_SCROLL_ID);
  if (index < 0) throw new Error('A resurrection scroll is required.');
  return inventory.filter((_, itemIndex) => itemIndex !== index);
}
