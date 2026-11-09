import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buyAuctionItem, cancelAuctionItem, listAuctionItem, type EconomySnapshot } from '../src/auctionOperations.js';
import { createAuctionTransactionStore } from '../src/auctionTransactions.js';

const itemIds = new Set(['iron_sword', 'herb_material']);
function player(name: string, gold: number, crystals: number, inventory: string[]) {
  return { name, gold, crystals, goldSpent: 0, itemsSold: 0, inventory: JSON.stringify(inventory),
    equipment: JSON.stringify({ weapon: '', helmet: '', armor: '', gloves: '', boots: '', cloak: '', amulet: '' }) };
}
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-economy-flow-'));
  const paths = { dataDir, playersFile: join(dataDir, 'players.json'), auctionFile: join(dataDir, 'auction.json'), historyFile: join(dataDir, 'auction_history.json') };
  const store = createAuctionTransactionStore(paths);
  const cleanup = () => rmSync(dataDir, { recursive: true, force: true });
  return { ...paths, store, cleanup };
}
function readJson(path: string) { return JSON.parse(readFileSync(path, 'utf8')); }
function initial(): EconomySnapshot {
  return { players: { seller: player('Seller', 1000, 100, ['iron_sword', 'herb_material']),
    buyer: player('Buyer', 2000, 80, []) }, auction: [], history: [] };
}

test('listing removes exactly one item, charges the 2% fee and persists the lot and history', () => {
  const f = fixture();
  try {
    const result = listAuctionItem({ snapshot: initial(), sellerId: 'seller', index: 0, expectedItemId: 'iron_sword',
      expectedCount: 1, price: 500, currency: 'gold', validItemIds: itemIds, itemName: 'Iron sword', now: 10, lotId: 'lot-1' });
    assert.deepEqual(JSON.parse(result.snapshot.players.seller.inventory), ['herb_material']);
    assert.equal(result.snapshot.players.seller.gold, 990);
    assert.equal(result.fee, 10);
    assert.equal(result.snapshot.auction.length, 1);
    assert.equal(result.snapshot.history[0].type, 'listed');
    f.store.commit(result.snapshot);
    assert.deepEqual(readJson(f.playersFile), result.snapshot.players);
    assert.deepEqual(readJson(f.auctionFile), result.snapshot.auction);
    assert.deepEqual(readJson(f.historyFile), result.snapshot.history);
  } finally { f.cleanup(); }
});

test('listing one duplicate does not unequip the remaining owned copy', () => {
  const start = initial();
  const seller = start.players.seller;
  seller.inventory = JSON.stringify(['iron_sword', 'iron_sword', 'herb_material']);
  seller.equipment = JSON.stringify({ weapon: 'iron_sword', helmet: '', armor: '', gloves: '', boots: '', cloak: '', amulet: '' });
  const listed = listAuctionItem({ snapshot: start, sellerId: 'seller', index: 0, expectedItemId: 'iron_sword',
    expectedCount: 2, price: 500, currency: 'gold', validItemIds: itemIds, itemName: 'Iron sword', now: 10, lotId: 'lot-duplicate' });
  assert.deepEqual(JSON.parse(listed.snapshot.players.seller.inventory), ['iron_sword', 'herb_material']);
  assert.equal(JSON.parse(listed.snapshot.players.seller.equipment).weapon, 'iron_sword');
});

test('withdrawal returns the item exactly once and does not refund the listing fee', () => {
  const start = initial();
  const listed = listAuctionItem({ snapshot: start, sellerId: 'seller', index: 0, expectedItemId: 'iron_sword',
    expectedCount: 1, price: 500, currency: 'gold', validItemIds: itemIds, itemName: 'Iron sword', now: 10, lotId: 'lot-1' }).snapshot;
  const withdrawn = cancelAuctionItem({ snapshot: listed, sellerId: 'seller', lotId: 'lot-1', validItemIds: itemIds, now: 20 });
  assert.deepEqual(JSON.parse(withdrawn.players.seller.inventory), ['herb_material', 'iron_sword']);
  assert.equal(withdrawn.players.seller.gold, 990);
  assert.equal(withdrawn.auction.length, 0);
  assert.equal(withdrawn.history.at(-1).type, 'cancelled');
  assert.throws(() => cancelAuctionItem({ snapshot: withdrawn, sellerId: 'seller', lotId: 'lot-1', validItemIds: itemIds, now: 21 }), /not found/);
});

test('purchase transfers one item and the exact net currency after the 5% gold fee', () => {
  const listed = listAuctionItem({ snapshot: initial(), sellerId: 'seller', index: 0, expectedItemId: 'iron_sword',
    expectedCount: 1, price: 500, currency: 'gold', validItemIds: itemIds, itemName: 'Iron sword', now: 10, lotId: 'lot-1' }).snapshot;
  const bought = buyAuctionItem({ snapshot: listed, buyerId: 'buyer', lotId: 'lot-1', validItemIds: itemIds, now: 30 });
  assert.deepEqual(JSON.parse(bought.snapshot.players.buyer.inventory), ['iron_sword']);
  assert.deepEqual(JSON.parse(bought.snapshot.players.seller.inventory), ['herb_material']);
  assert.equal(bought.snapshot.players.buyer.gold, 1500);
  assert.equal(bought.snapshot.players.seller.gold, 1465);
  assert.equal(bought.fee, 25);
  assert.equal(bought.net, 475);
  assert.equal(bought.snapshot.auction.length, 0);
  assert.equal(bought.snapshot.history.at(-1).status, 'completed');
  assert.equal(bought.snapshot.players.buyer.gold + bought.snapshot.players.seller.gold, 2965);
});

test('crystal purchase transfers crystals without a gold auction fee', () => {
  const start = initial();
  const listed = listAuctionItem({ snapshot: start, sellerId: 'seller', index: 0, expectedItemId: 'iron_sword',
    expectedCount: 1, price: 40, currency: 'crystals', validItemIds: itemIds, itemName: 'Iron sword', now: 10, lotId: 'lot-crystal' }).snapshot;
  const bought = buyAuctionItem({ snapshot: listed, buyerId: 'buyer', lotId: 'lot-crystal', validItemIds: itemIds, now: 30 });
  assert.equal(bought.snapshot.players.buyer.crystals, 40);
  assert.equal(bought.snapshot.players.seller.crystals, 139);
  assert.equal(bought.fee, 0);
  assert.equal(bought.net, 40);
});

test('rejects stale inventory, insufficient funds, self-purchase and repeat purchase without changing inputs', () => {
  const start = initial();
  assert.throws(() => listAuctionItem({ snapshot: start, sellerId: 'seller', index: 0, expectedItemId: 'herb_material',
    price: 500, currency: 'gold', validItemIds: itemIds, itemName: 'Herb', now: 10, lotId: 'bad' }), /Inventory changed/);
  assert.deepEqual(JSON.parse(start.players.seller.inventory), ['iron_sword', 'herb_material']);
  const listed = listAuctionItem({ snapshot: start, sellerId: 'seller', index: 0, price: 500, currency: 'gold',
    validItemIds: itemIds, itemName: 'Iron sword', now: 10, lotId: 'lot-1' }).snapshot;
  const poor = structuredClone(listed);
  poor.players.buyer.gold = 1;
  assert.throws(() => buyAuctionItem({ snapshot: poor, buyerId: 'buyer', lotId: 'lot-1', validItemIds: itemIds, now: 20 }), /Insufficient/);
  assert.throws(() => buyAuctionItem({ snapshot: listed, buyerId: 'seller', lotId: 'lot-1', validItemIds: itemIds, now: 20 }), /own lot/);
  const bought = buyAuctionItem({ snapshot: listed, buyerId: 'buyer', lotId: 'lot-1', validItemIds: itemIds, now: 30 }).snapshot;
  assert.throws(() => buyAuctionItem({ snapshot: bought, buyerId: 'buyer', lotId: 'lot-1', validItemIds: itemIds, now: 31 }), /no longer available/);
});

test('recovery after a simulated disconnect restores both players and the auction state from one journal', () => {
  const f = fixture();
  try {
    const listed = listAuctionItem({ snapshot: initial(), sellerId: 'seller', index: 0, expectedItemId: 'iron_sword',
      expectedCount: 1, price: 500, currency: 'gold', validItemIds: itemIds, itemName: 'Iron sword', now: 10, lotId: 'lot-1' }).snapshot;
    const bought = buyAuctionItem({ snapshot: listed, buyerId: 'buyer', lotId: 'lot-1', validItemIds: itemIds, now: 30 }).snapshot;
    writeFileSync(f.store.journalFile, JSON.stringify({ version: 1, snapshot: bought }));
    assert.equal(f.store.recover(), true);
    const saved = readJson(f.playersFile);
    assert.deepEqual(JSON.parse(saved.buyer.inventory), ['iron_sword']);
    assert.deepEqual(JSON.parse(saved.seller.inventory), ['herb_material']);
    assert.equal(saved.buyer.gold, 1500);
    assert.equal(saved.seller.gold, 1465);
    assert.equal(readJson(f.auctionFile).length, 0);
    assert.equal(readJson(f.historyFile).at(-1).status, 'completed');
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});

test('malformed lot data is rejected before any player balance or inventory changes', () => {
  const broken = initial();
  broken.auction.push({ id: 'bad', itemId: 'iron_sword', sellerId: 'seller', price: -10, currency: 'gold', status: 'active' } as any);
  assert.throws(() => buyAuctionItem({ snapshot: broken, buyerId: 'buyer', lotId: 'bad', validItemIds: itemIds, now: 40 }), /invalid lot/);
  assert.equal(broken.players.buyer.gold, 2000);
  assert.deepEqual(JSON.parse(broken.players.buyer.inventory), []);
});
