export type EconomyPlayer = Record<string, any>;
export type AuctionLot = {
  id: string; itemId: string; itemName: string; sellerId: string; sellerName: string;
  price: number; currency: 'gold' | 'crystals'; createdAt: number; status: 'active';
  [key: string]: any;
};
export type EconomySnapshot = { players: Record<string, EconomyPlayer>; auction: AuctionLot[]; history: any[] };

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function inventoryOf(player: EconomyPlayer): string[] {
  let value: unknown;
  try { value = JSON.parse(String(player.inventory ?? '[]')); } catch { throw new Error('Player inventory is unreadable.'); }
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string')) throw new Error('Player inventory is invalid.');
  return value;
}
function equipmentOf(player: EconomyPlayer): Record<string, any> {
  let value: unknown;
  try { value = JSON.parse(String(player.equipment ?? '{}')); } catch { throw new Error('Player equipment is unreadable.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Player equipment is invalid.');
  return value as Record<string, any>;
}
function validPrice(price: number): boolean { return Number.isSafeInteger(price) && price >= 1 && price <= 100_000_000; }
function validateLots(lots: AuctionLot[], validItemIds: ReadonlySet<string>) {
  if (!Array.isArray(lots)) throw new Error('Auction listing data is invalid.');
  for (const lot of lots) {
    if (!lot || typeof lot !== 'object' || Array.isArray(lot)
      || typeof lot.id !== 'string' || !lot.id
      || typeof lot.sellerId !== 'string' || !lot.sellerId
      || typeof lot.itemId !== 'string' || !validItemIds.has(lot.itemId)
      || !validPrice(lot.price) || !['gold', 'crystals'].includes(lot.currency)
      || (lot.status !== undefined && lot.status !== 'active')) {
      throw new Error('Auction listing contains an invalid lot; transaction cancelled.');
    }
  }
}
function appendHistory(history: any[], entry: any): any[] {
  if (!Array.isArray(history) || history.some(x => !x || typeof x !== 'object' || Array.isArray(x))) {
    throw new Error('Auction history data is invalid.');
  }
  return [...history, entry].slice(-5000);
}

export function listAuctionItem(input: {
  snapshot: EconomySnapshot; sellerId: string; index: number; expectedItemId?: string;
  expectedCount?: number; price: number; currency: string; validItemIds: ReadonlySet<string>;
  itemName: string; now: number; lotId: string;
}): { snapshot: EconomySnapshot; lot: AuctionLot; fee: number } {
  const next = clone(input.snapshot);
  validateLots(next.auction, input.validItemIds);
  const seller = next.players[input.sellerId];
  if (!seller) throw new Error('Seller is missing from the player save.');
  if (!Number.isInteger(input.index) || input.index < 0 || !validPrice(input.price)) throw new Error('Check the item and lot price.');
  if (input.currency !== 'gold' && input.currency !== 'crystals') throw new Error('Invalid auction currency.');
  const inventory = inventoryOf(seller);
  if (input.index >= inventory.length) throw new Error('Item is not in the inventory.');
  const itemId = inventory[input.index];
  if (input.expectedItemId && input.expectedItemId !== itemId) throw new Error('Inventory changed; refresh and select the item again.');
  if (input.expectedItemId && Number.isInteger(input.expectedCount)
    && inventory.filter(x => x === input.expectedItemId).length !== input.expectedCount) {
    throw new Error('Item quantity changed; listing cancelled.');
  }
  if (!input.validItemIds.has(itemId)) throw new Error('This item cannot be listed.');
  if (next.auction.filter(x => x.sellerId === input.sellerId).length >= 10) throw new Error('Maximum 10 active lots per player.');
  const fee = Math.max(1, Math.floor(input.price * 0.02));
  const field = input.currency === 'gold' ? 'gold' : 'crystals';
  if (!Number.isSafeInteger(Number(seller[field])) || Number(seller[field]) < fee) throw new Error('Not enough currency for the listing fee.');
  seller[field] = Number(seller[field]) - fee;
  if (field === 'gold') seller.goldSpent = Number(seller.goldSpent || 0) + fee;
  inventory.splice(input.index, 1);
  seller.inventory = JSON.stringify(inventory);
  const equipment = equipmentOf(seller);
  for (const slot of ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'cloak', 'amulet']) {
    if (equipment[slot] === itemId) equipment[slot] = '';
  }
  seller.equipment = JSON.stringify(equipment);
  const lot: AuctionLot = {
    id: input.lotId, itemId, itemName: input.itemName || itemId, sellerId: input.sellerId,
    sellerName: String(seller.name || ''), price: input.price, currency: input.currency,
    createdAt: input.now, status: 'active',
  };
  next.auction.push(lot);
  next.history = appendHistory(next.history, {
    id: `tx_listed_${input.lotId}`, lotId: input.lotId, type: 'listed', itemId,
    itemName: lot.itemName, sellerId: input.sellerId, sellerName: lot.sellerName,
    price: input.price, currency: input.currency, fee, createdAt: input.now, status: 'listed',
  });
  return { snapshot: next, lot, fee };
}

export function cancelAuctionItem(input: {
  snapshot: EconomySnapshot; sellerId: string; lotId: string; validItemIds: ReadonlySet<string>; now: number;
}): EconomySnapshot {
  const next = clone(input.snapshot);
  validateLots(next.auction, input.validItemIds);
  const index = next.auction.findIndex(x => x.id === input.lotId && x.sellerId === input.sellerId);
  if (index < 0) throw new Error('Active lot not found or belongs to another player.');
  const lot = next.auction[index];
  const seller = next.players[input.sellerId];
  if (!seller) throw new Error('Seller is missing from the player save.');
  const inventory = inventoryOf(seller);
  inventory.push(lot.itemId);
  seller.inventory = JSON.stringify(inventory);
  next.auction.splice(index, 1);
  next.history = appendHistory(next.history, {
    id: `tx_cancel_${lot.id}_${input.now}`, lotId: lot.id, type: 'cancelled',
    itemId: lot.itemId, itemName: lot.itemName, sellerId: input.sellerId,
    sellerName: String(seller.name || ''), price: lot.price, currency: lot.currency,
    fee: 0, createdAt: input.now, status: 'cancelled',
  });
  return next;
}

export function buyAuctionItem(input: {
  snapshot: EconomySnapshot; buyerId: string; lotId: string; validItemIds: ReadonlySet<string>;
  uniqueItemIds?: ReadonlySet<string>; now: number;
}): { snapshot: EconomySnapshot; fee: number; net: number; lot: AuctionLot } {
  const next = clone(input.snapshot);
  validateLots(next.auction, input.validItemIds);
  const index = next.auction.findIndex(x => x.id === input.lotId);
  if (index < 0) throw new Error('Lot is no longer available.');
  const lot = next.auction[index];
  if (lot.sellerId === input.buyerId) throw new Error('Cannot buy your own lot.');
  const buyer = next.players[input.buyerId];
  const seller = next.players[lot.sellerId];
  if (!buyer) throw new Error('Buyer is missing from the player save.');
  if (!seller) throw new Error('Seller not found; purchase cancelled.');
  const inventory = inventoryOf(buyer);
  if (input.uniqueItemIds?.has(lot.itemId) && inventory.includes(lot.itemId)) throw new Error('This unique item is already owned.');
  const field = lot.currency;
  if (!Number.isSafeInteger(Number(buyer[field])) || Number(buyer[field]) < lot.price) throw new Error('Insufficient currency.');
  const fee = field === 'gold' ? Math.max(1, Math.floor(lot.price * 0.05)) : 0;
  const net = lot.price - fee;
  buyer[field] = Number(buyer[field]) - lot.price;
  if (field === 'gold') buyer.goldSpent = Number(buyer.goldSpent || 0) + lot.price;
  seller[field] = Number(seller[field] || 0) + net;
  seller.itemsSold = Number(seller.itemsSold || 0) + 1;
  inventory.push(lot.itemId);
  buyer.inventory = JSON.stringify(inventory);
  next.auction.splice(index, 1);
  next.history = appendHistory(next.history, {
    id: `tx_sold_${lot.id}_${input.now}`, lotId: lot.id, type: 'sold',
    itemId: lot.itemId, itemName: lot.itemName, sellerId: lot.sellerId,
    sellerName: lot.sellerName, buyerId: input.buyerId, buyerName: String(buyer.name || ''),
    price: lot.price, currency: field, fee, createdAt: input.now, status: 'completed',
  });
  return { snapshot: next, fee, net, lot };
}
