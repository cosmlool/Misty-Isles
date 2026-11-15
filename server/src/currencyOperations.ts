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
