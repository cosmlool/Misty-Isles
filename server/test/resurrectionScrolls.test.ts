import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumeResurrectionScroll,
  purchaseResurrectionScroll,
  RESURRECTION_SCROLL_ID,
} from '../src/resurrectionScrolls.js';

test('resurrection scroll costs 100 crystals and is added to inventory', () => {
  const result = purchaseResurrectionScroll({
    inventory: ['moon_dust'], crystals: 250, inCity: true, inActiveDungeon: false,
  });
  assert.deepEqual(result.inventory, ['moon_dust', RESURRECTION_SCROLL_ID]);
  assert.equal(result.crystals, 150);
});

test('inventory cannot hold more than two resurrection scrolls', () => {
  assert.throws(() => purchaseResurrectionScroll({
    inventory: [RESURRECTION_SCROLL_ID, RESURRECTION_SCROLL_ID],
    crystals: 500, inCity: true, inActiveDungeon: false,
  }), /at most two/);
});

test('scroll purchase requires a city, no active dungeon, and sufficient crystals', () => {
  const base = { inventory: [] as string[], crystals: 100, inCity: true, inActiveDungeon: false };
  assert.throws(() => purchaseResurrectionScroll({ ...base, inCity: false }), /only be purchased in a city/);
  assert.throws(() => purchaseResurrectionScroll({ ...base, inActiveDungeon: true }), /active dungeon/);
  assert.throws(() => purchaseResurrectionScroll({ ...base, crystals: 99 }), /Not enough crystals/);
});

test('revival consumes exactly one scroll and leaves unrelated inventory untouched', () => {
  const inventory = ['moon_dust', RESURRECTION_SCROLL_ID, 'iron_scrap', RESURRECTION_SCROLL_ID];
  assert.deepEqual(consumeResurrectionScroll(inventory), ['moon_dust', 'iron_scrap', RESURRECTION_SCROLL_ID]);
  assert.throws(() => consumeResurrectionScroll(['moon_dust']), /scroll is required/);
});
