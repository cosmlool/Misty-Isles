# Economy counters and transfer integrity audit

Date: 2026-11-16
Scope: player gold counters, auction sale counters, PvP gold transfer, and the currently visible server mutation call sites. Static source review plus regression-test additions; GitHub Actions validation pending. Local tests were not run.

## Counter semantics observed

| Field | Current meaning established by call sites | Mutation sources found |
|---|---|---|
| `goldEarned` | Gross gold granted by game reward/admin flows; not a net wealth measure | Dungeon and expedition wins; daily/fountain/race/faction/challenge/quest/return/achievement rewards; tavern winnings; chest rewards; admin gold grant |
| `goldSpent` | Gold paid into sinks, including fees and purchases | Pendant/set-related progression where gold applies; profession/stat/building upgrades; shop/faction purchases; protection/enhancement flows; blessings; tavern stakes; clan creation/deposits; auction listing fee and buyer's gross purchase price |
| `itemsSold` | Number of auction lots sold by this player as seller | Incremented by the auction purchase operation; no other current increment was found |
| `gold` | Current spendable balance | Reward grants, costs, auction transfers, PvP transfers, admin adjustments and reset |

PvP transfers deliberately do not increment `goldEarned` or `goldSpent`: they move existing gold between two players and do not create or destroy currency. Auction seller proceeds likewise represent a transfer, while the buyer's gross payment and listing fee are counted as sinks. This keeps reward-earned and sink counters distinct from transfer volume.

## Confirmed issue and remediation

The PvP outcome helper previously coerced malformed values and clamped negative balances to zero, while allowing fractional/unsafe integer balances and unchecked winner-balance addition. This differed from the safe-integer checks already used by auction operations.

- `resolvePvpOutcome` now requires both balances to be nonnegative safe integers.
- It rejects a transfer if either resulting balance would exceed the safe integer range.
- Valid outcomes retain the existing 20% transfer formula, immunity recipient, and duration.
- Regression tests cover negative, fractional, NaN, Infinity, unsafe-integer inputs, winner overflow, and exact total-gold conservation for valid transfers.
- The production PvP handler already wraps the transaction in rollback-on-error handling; a thrown validation error restores both player snapshots and aborts the shared transaction.

## Remaining hardening observations

- Other gameplay handlers still update `goldEarned` and `goldSpent` with direct `+=` arithmetic rather than a shared safe-counter helper. The auction operations now guard their own counters, but this protection is not universal.
- Player-save loading currently permits finite, type-compatible numeric fields without a global nonnegative safe-integer rule for all economy fields. Applying a blanket rule would risk rejecting or changing existing saves before a sanitized legacy-save corpus and field semantics are established.
- `itemsSold` is an auction-sale count, not a general player-to-player or NPC-sale metric. No new sales paths were added in this audit.
- Achievement rewards themselves add to `goldEarned`; thresholds are evaluated from the pre-reward values captured when the achievement request begins, and the claimed flags prevent repeated reward grants. No change made to this existing definition.
- This pass did not establish a confirmed duplicate reward/transaction path in the audited counter call sites. A full cross-handler idempotency audit remains separate work.

## Safety boundary

No reward amounts, prices, fees, transfer percentages, achievement thresholds, progression formulas, save data, or balance semantics were changed. No migrations or automatic repair of player counters were introduced. The PvP guard only rejects malformed or unsafe persisted balances that cannot be represented reliably as integer currency.
