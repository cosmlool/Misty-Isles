export const MAX_GOLD_BALANCE = 9_999_999_999;
export const MAX_CRYSTALS_BALANCE = 50_000;

export type PlayerCurrency = 'gold' | 'crystals';

export type CurrencyCreditResult = {
  balance: number;
  credited: number;
  burned: number;
};

/**
 * Apply a currency credit under the hard player-balance cap.
 * Existing excess is discarded first; any new amount above the remaining
 * capacity is burned and is never queued or credited later.
 */
export function calculateCappedCurrencyCredit(
  currentBalance: number,
  amount: number,
  currency: PlayerCurrency,
): CurrencyCreditResult {
  const cap = currency === 'gold' ? MAX_GOLD_BALANCE : MAX_CRYSTALS_BALANCE;
  if (!Number.isFinite(currentBalance) || currentBalance < 0
    || (currentBalance <= cap && !Number.isSafeInteger(currentBalance))) {
    throw new Error('Currency balance must be a nonnegative safe integer.');
  }
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Currency credit must be a nonnegative safe integer.');
  }
  const startingBalance = Math.min(currentBalance, cap);
  const capacity = cap - startingBalance;
  const credited = Math.min(amount, capacity);
  return {
    balance: startingBalance + credited,
    credited,
    burned: (currentBalance - startingBalance) + (amount - credited),
  };
}

export function creditGold(currentBalance: number, amount: number): CurrencyCreditResult {
  return calculateCappedCurrencyCredit(currentBalance, amount, 'gold');
}

export function creditCrystals(currentBalance: number, amount: number): CurrencyCreditResult {
  return calculateCappedCurrencyCredit(currentBalance, amount, 'crystals');
}


export type GemExchangeResult = {
  gemsBalance: number;
  crystalsBalance: number;
  crystalsCredited: number;
  crystalsBurned: number;
};

/** Prepare both sides of a gem exchange before mutating either player balance. */
export function prepareGemExchange(
  gemsBalance: number,
  crystalsBalance: number,
  amount: number,
): GemExchangeResult {
  if (!Number.isSafeInteger(gemsBalance) || gemsBalance < 0) {
    throw new Error('Gem balance must be a nonnegative safe integer.');
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > gemsBalance) {
    throw new Error('Gem exchange amount must be a positive safe integer within the available balance.');
  }
  const crystalCredit = creditCrystals(crystalsBalance, amount * 10);
  return {
    gemsBalance: gemsBalance - amount,
    crystalsBalance: crystalCredit.balance,
    crystalsCredited: crystalCredit.credited,
    crystalsBurned: crystalCredit.burned,
  };
}


export type PlayerCurrencyBalances = {
  gold: number;
  crystals: number;
  gems: number;
  capped: boolean;
};

/** Prepare an uncapped gem credit without allowing JavaScript integer overflow. */
export function prepareGemCredit(currentBalance: number, amount: number): number {
  if (!Number.isSafeInteger(currentBalance) || currentBalance < 0) {
    throw new Error('Gem balance must be a nonnegative safe integer.');
  }
  if (!Number.isSafeInteger(amount) || amount < 0
    || !Number.isSafeInteger(currentBalance + amount)) {
    throw new Error('Gem credit would exceed the safe-integer range.');
  }
  return currentBalance + amount;
}

/** Validate legacy balances and normalize only finite over-cap gold/crystals. */
export function preparePlayerCurrencyBalances(
  gold: number,
  crystals: number,
  gems: number,
): PlayerCurrencyBalances {
  const normalizedGold = creditGold(gold, 0).balance;
  const normalizedCrystals = creditCrystals(crystals, 0).balance;
  if (!Number.isSafeInteger(gems) || gems < 0) {
    throw new Error('Gem balance must be a nonnegative safe integer.');
  }
  return {
    gold: normalizedGold,
    crystals: normalizedCrystals,
    gems,
    capped: normalizedGold !== gold || normalizedCrystals !== crystals,
  };
}
