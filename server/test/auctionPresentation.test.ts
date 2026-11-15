import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAuctionHistory, projectAuctionLots, projectPublicMarketHistory } from '../src/auctionPresentation.js';

test('active lot projection allowlists client fields and omits malformed legacy rows', () => {
  const result = projectAuctionLots([
    { id: 'lot-1', itemId: 'sword', itemName: 'Sword', sellerId: 'seller', sellerName: 'Seller',
      price: 500, currency: 'gold', createdAt: 100, status: 'active', passwordHash: 'secret', internalNote: 'private' },
    { id: 'bad-price', itemId: 'sword', sellerId: 'seller', price: -1, currency: 'gold', createdAt: 100 },
    { id: 'bad-time', itemId: 'sword', sellerId: 'seller', price: 10, currency: 'gold', createdAt: Number.NaN },
    { id: 'duplicate', itemId: 'sword', sellerId: 'seller', price: 10, currency: 'gold', createdAt: 100 },
    { id: 'duplicate', itemId: 'shield', sellerId: 'seller', price: 20, currency: 'gold', createdAt: 100 },
    { id: 'inactive', itemId: 'sword', sellerId: 'seller', price: 10, currency: 'gold', createdAt: 100, status: 'sold' },
    null,
  ]);
  assert.deepEqual(result, [{
    id: 'lot-1', itemId: 'sword', itemName: 'Sword', sellerId: 'seller', sellerName: 'Seller',
    price: 500, currency: 'gold', createdAt: 100, status: 'active',
  }]);
  assert.equal('passwordHash' in result[0], false);
  assert.equal('internalNote' in result[0], false);
});

test('legacy lot defaults remain readable without exposing unknown properties', () => {
  assert.deepEqual(projectAuctionLots([{
    id: 'legacy-lot', itemId: 'old-sword', sellerId: 'seller', price: 25,
    currency: 'crystals', createdAt: 1, legacyFlag: true,
  }]), [{
    id: 'legacy-lot', itemId: 'old-sword', itemName: 'old-sword', sellerId: 'seller',
    sellerName: '', price: 25, currency: 'crystals', createdAt: 1, status: 'active',
  }]);
});

test('history projection preserves supported transaction fields but never forwards unknown fields', () => {
  const result = projectAuctionHistory([
    { id: 'tx-1', lotId: 'lot-1', type: 'sold', itemId: 'sword', itemName: 'Sword',
      sellerId: 'seller', sellerName: 'Seller', buyerId: 'buyer', buyerName: 'Buyer',
      price: 500, currency: 'gold', fee: 25, createdAt: 200, status: 'completed',
      authToken: 'private-token', internalPayload: { secret: true } },
    { id: 'bad', lotId: 'lot-2', type: 'sold', itemId: 'sword', sellerId: 'seller',
      price: 500, currency: 'gold', fee: -1, createdAt: 200, status: 'completed' },
    { id: 'bad-status', lotId: 'lot-3', type: 'sold', itemId: 'sword', sellerId: 'seller',
      price: 500, currency: 'gold', fee: 1, createdAt: 200, status: 'listed' },
    { id: 'bad-buyer', lotId: 'lot-4', type: 'sold', itemId: 'sword', sellerId: 'seller',
      buyerId: { forged: true }, price: 500, currency: 'gold', fee: 1, createdAt: 200, status: 'completed' },
  ]);
  assert.deepEqual(result, [{
    id: 'tx-1', lotId: 'lot-1', type: 'sold', itemId: 'sword', itemName: 'Sword',
    sellerId: 'seller', sellerName: 'Seller', buyerId: 'buyer', buyerName: 'Buyer',
    price: 500, currency: 'gold', fee: 25, createdAt: 200, status: 'completed',
  }]);
  assert.equal('authToken' in result[0], false);
  assert.equal('internalPayload' in result[0], false);
});

test('history projection keeps valid legacy event shape and safely defaults optional display names', () => {
  assert.deepEqual(projectAuctionHistory([{
    id: 'tx-list', lotId: 'lot-1', type: 'listed', itemId: 'sword', sellerId: 'seller',
    price: 25, currency: 'crystals', fee: 1, createdAt: 50,
  }]), [{
    id: 'tx-list', lotId: 'lot-1', type: 'listed', itemId: 'sword', itemName: 'sword',
    sellerId: 'seller', sellerName: '', price: 25, currency: 'crystals', fee: 1,
    createdAt: 50, status: 'listed',
  }]);
});

test('public market analytics omit internal player identifiers and participant names', () => {
  const result = projectPublicMarketHistory([{
    id: 'tx-sale', lotId: 'lot-1', type: 'sold', itemId: 'sword', itemName: 'Sword',
    sellerId: 'internal-seller-id', sellerName: 'Seller', buyerId: 'internal-buyer-id',
    buyerName: 'Buyer', price: 500, currency: 'gold', fee: 25, createdAt: 200,
    status: 'completed', privateExtra: 'must not leak',
  }, {
    id: 'tx-listed', lotId: 'lot-2', type: 'listed', itemId: 'shield', sellerId: 'seller',
    price: 100, currency: 'gold', fee: 2, createdAt: 201, status: 'listed',
  }]);
  assert.deepEqual(result, [{
    type: 'sold', itemName: 'Sword', price: 500, currency: 'gold',
    fee: 25, createdAt: 200, status: 'completed',
  }]);
  assert.equal('sellerId' in result[0], false);
  assert.equal('buyerId' in result[0], false);
  assert.equal('sellerName' in result[0], false);
  assert.equal('buyerName' in result[0], false);
});
