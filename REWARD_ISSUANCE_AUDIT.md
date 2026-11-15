# Reward issuance and currency replay audit

Date: 2026-11-16
Scope: daily and one-time quest rewards, achievements, return/fountain rewards, chest opening, and existing economy runtime regression coverage. Static production-handler review plus focused helper tests; GitHub Actions validation pending. Local tests were not run.

## Confirmed reward-claim safeguards

- Story chapters, faction chapters, faction max rewards, daily/weekly challenges, and ordinary quest rewards write their completion/claim flags before applying reward changes in the same synchronous authenticated message handler.
- Race daily claims record the quest ID in the daily `claimed` list before awarding gold, XP, and reputation.
- Achievement rewards set the achievement flags and persist the achievement object after evaluating all eligible rewards; repeated requests see the flags and do not pay again.
- Daily login uses a UTC date key and stores the new day before granting gold, XP, and a potion. The runtime suite covers consecutive/missed-day streak behavior and repeated same-day rejection.
- Existing `questRewardsRuntime.test.ts` exercises duplicate story/faction/daily/weekly/achievement claims against an isolated live server and verifies no second payout.
- These flows are synchronous in the Colyseus message handler; the reviewed claim flag and payout are part of the same in-memory player mutation and later player-save snapshot. No asynchronous yield exists between the gate and the reward within these handlers.

## Confirmed replay gap and remediation: opening stacked mystery chests

The client sends inventory index, item ID, and the displayed stack count when opening a chest. The server previously treated the item ID and expected count as optional. A replayed/stale index request could therefore omit the snapshot count; if another chest shifted into the same index after the first removal, the second request could open that adjacent chest too.

- Added `validateInventoryStackAction()` to require an exact item ID, valid index, positive safe-integer expected count, and equality with the current count of that item in inventory.
- The `openChest` handler now requires this validation before removing a chest or rolling any reward.
- This prevents an old request from consuming another chest after the inventory stack changes. It does not change chest odds, reward tables, or the contents of a valid chest opening.
- Added unit regression tests for missing/mismatched IDs, missing/fractional/unsafe counts, stale counts, invalid indices, and replay after one stacked chest has been removed.
- Client already sends all three required fields (`index`, `itemId`, `expectedCount`), so no client protocol change was needed.

## Currency scope observations

- Daily login, fountain, story/quest, faction chapter, challenge, achievements, return reward, tavern, monster/exploration, dungeon, chest, and admin paths are direct gold reward sources; chest crystal fragments and gem exchange also touch crystals.
- The reviewed quest and achievement handlers have explicit one-time claim markers. Daily login and fountain use date guards. Return reward uses its availability flag plus a seven-day timestamp guard.
- `exchangeGem` is a one-way internal conversion: amount is clamped to 1..100000 and requires sufficient gems before decrementing gems and crediting 10 crystals per gem. No blockchain or external payment integration is present in this path.
- `buyItem`, `factionBuy`, and `buyProtectionSeal` are repeatable purchases by design, each charging before appending the purchased item. No new restriction was introduced.
- Direct gold/counter arithmetic in several reward handlers remains a separate safe-integer hardening task; do not globally normalize legacy player balances without sanitized historical save fixtures.
- This pass did not find a second concrete duplicate-payout issue in the inspected quest, achievement, daily login, or conversion paths. It is not a proof that every reward handler or every crash window is fully idempotent.

## Safety boundary

No player saves, currencies, reward amounts, chest odds, item drops, quest thresholds, progression formulas, or exchange rates were changed. No migration or automatic repair was added. Full runtime validation remains pending in GitHub Actions.
