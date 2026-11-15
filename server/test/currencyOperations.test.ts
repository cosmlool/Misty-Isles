import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCappedCurrencyCredit,
  creditCrystals,
  creditGold,
  MAX_CRYSTALS_BALANCE,
  MAX_GOLD_BALANCE,
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
