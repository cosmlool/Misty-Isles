import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCappedCurrencyCredit,
  creditCrystals,
  creditGold,
  MAX_CRYSTALS_BALANCE,
  MAX_GOLD_BALANCE,
  prepareGemCredit,
} from '../src/currencyOperations.js';

test('gold balance never exceeds 9,999,999,999 and excess is burned', () => {
  assert.deepEqual(creditGold(MAX_GOLD_BALANCE - 5, 12), {
    balance: MAX_GOLD_BALANCE, credited: 5, burned: 7,
  });
  assert.deepEqual(creditGold(MAX_GOLD_BALANCE, 1), {
    balance: MAX_GOLD_BALANCE, credited: 0, burned: 1,
  });
});

test('crystal balance never exceeds 50,000 and excess is burned', () => {
  assert.deepEqual(creditCrystals(49_995, 12), {
    balance: MAX_CRYSTALS_BALANCE, credited: 5, burned: 7,
  });
  assert.deepEqual(creditCrystals(MAX_CRYSTALS_BALANCE, 10), {
    balance: MAX_CRYSTALS_BALANCE, credited: 0, burned: 10,
  });
});

test('legacy balances above the cap are clamped before any new credit', () => {
  assert.deepEqual(creditGold(MAX_GOLD_BALANCE + 10, 0), {
    balance: MAX_GOLD_BALANCE, credited: 0, burned: 10,
  });
  assert.deepEqual(creditCrystals(MAX_CRYSTALS_BALANCE + 4, 3), {
    balance: MAX_CRYSTALS_BALANCE, credited: 0, burned: 7,
  });
});

test('zero credit preserves a valid balance', () => {
  assert.deepEqual(calculateCappedCurrencyCredit(123, 0, 'gold'), {
    balance: 123, credited: 0, burned: 0,
  });
});

test('invalid, fractional, negative and unsafe amounts fail closed', () => {
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => creditGold(value, 1));
    assert.throws(() => creditCrystals(1, value));
  }
});


test('finite legacy balances above the cap clamp even when outside the safe-integer range', () => {
  assert.equal(creditGold(Number.MAX_SAFE_INTEGER + 1, 1).balance, MAX_GOLD_BALANCE);
  assert.equal(creditCrystals(Number.MAX_SAFE_INTEGER + 1, 1).balance, MAX_CRYSTALS_BALANCE);
});


test('gem exchange prepares both balances atomically and burns crystal overflow', async () => {
  const { prepareGemExchange } = await import('../src/currencyOperations.js');
  assert.deepEqual(prepareGemExchange(10, 49_950, 10), {
    gemsBalance: 0, crystalsBalance: 50_000, crystalsCredited: 50, crystalsBurned: 50,
  });
});

test('invalid crystal balance rejects gem exchange before either balance can be changed', async () => {
  const { prepareGemExchange } = await import('../src/currencyOperations.js');
  for (const crystals of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => prepareGemExchange(25, crystals, 2));
  }
  for (const gems of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => prepareGemExchange(gems, 100, 2));
  }
  assert.throws(() => prepareGemExchange(1, 100, 2));
});


test('player currency validation clamps finite over-cap legacy balances and rejects malformed balances', async () => {
  const { preparePlayerCurrencyBalances } = await import('../src/currencyOperations.js');
  assert.deepEqual(preparePlayerCurrencyBalances(MAX_GOLD_BALANCE + 10, MAX_CRYSTALS_BALANCE + 5, 7), {
    gold: MAX_GOLD_BALANCE, crystals: MAX_CRYSTALS_BALANCE, gems: 7, capped: true,
  });
  for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => preparePlayerCurrencyBalances(invalid, 10, 0));
    assert.throws(() => preparePlayerCurrencyBalances(10, invalid, 0));
    assert.throws(() => preparePlayerCurrencyBalances(10, 10, invalid));
  }
  assert.equal(preparePlayerCurrencyBalances(10, 20, 0).capped, false);
});


test('gem credits remain uncapped but reject unsafe-integer overflow atomically', () => {
  assert.equal(prepareGemCredit(10, 25), 35);
  assert.equal(prepareGemCredit(Number.MAX_SAFE_INTEGER - 1, 1), Number.MAX_SAFE_INTEGER);
  for (const [balance, amount] of [
    [-1, 1],
    [1.5, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [Number.MAX_SAFE_INTEGER, 1],
    [Number.MAX_SAFE_INTEGER - 1, 2],
    [10, -1],
    [10, 1.5],
  ]) {
    assert.throws(() => prepareGemCredit(balance, amount));
  }
});
