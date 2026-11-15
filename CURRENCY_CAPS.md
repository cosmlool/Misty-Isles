# Player currency balance caps

Date: 2026-11-16

## Approved rules

- Gold balance cap: **9,999,999,999**.
- Crystal balance cap: **50,000**.
- A credit is accepted only up to the remaining capacity. Every excess unit is burned immediately; it is not stored, queued, converted into another currency, or credited later.
- Gems have no new cap in this change; the approved limits apply only to gold and crystals.

## Implementation

- `server/src/currencyOperations.ts` contains the shared capped-credit calculation and rejects negative, fractional, non-finite, or unsafe integer inputs.
- All direct player gold/crystal credit sites in `server/src/index.ts` now use the shared cap: dungeon and expedition payouts, daily/fountain rewards, race/quest/challenge/achievement/return rewards, tavern wins, chest rewards, crystal fragments, clan-territory crystal rewards, gem exchange, and allowlisted admin grants.
- Authenticated gameplay actions clamp any finite positive existing balance above the cap (including unsafe-integer legacy values) and persist the clamped balance. Non-finite or negative balances remain invalid. This is lazy per-player normalization, not a bulk save migration. This is lazy per-player normalization, not a bulk save migration.
- PvP still removes the existing 20% of the loser's capped balance. The winner receives only remaining capacity; the remainder burns. PvP result details distinguish gross stolen gold from credited gold and burned excess.
- Auction buyers still pay the full listed price. Seller proceeds are capped at the seller's remaining balance capacity; the excess burns. Existing auction fees and pricing are unchanged.
- Spending paths remain unchanged after the authenticated-action cap check. Gold earned/spent lifetime counters retain their historical gross-counter semantics; `goldEarned` records the generated reward even if part of the balance credit burns.
- No change to reward amounts, PvP transfer percentage, auction fee rates, gem exchange rate, item prices, or gameplay progression.

## Regression coverage

- `server/test/currencyOperations.test.ts`: both limits, exact boundary, overflow burn, legacy safe/unsafe over-cap clamp, and invalid values.
- `server/test/pvpOperations.test.ts`: capped PvP transfer, burned excess, legacy over-cap normalization, and unchanged 20% transfer rule.
- `server/test/auctionOperations.test.ts`: capped gold and crystal seller proceeds and burned excess.
- `server/test/questRewardsRuntime.test.ts`: isolated live-server daily reward and gem exchange at both caps.

Local tests were not run. GitHub Actions Quality Gate is required before treating the implementation as validated.