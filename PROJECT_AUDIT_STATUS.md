# Misty Isles — Project Audit Status

Updated: 2026-11-09 (continued audit checkpoint)

## Purpose and handoff rule

This file is the durable checkpoint for the ongoing full-game audit. On every chat transition, read this file first, then verify the referenced GitHub branch/PR and current commit before continuing. Do not repeat completed checks unless the code changed, a test failed, or the previous evidence was incomplete.

Do not merge to `main`, change gameplay rules, or alter real player data without explicit user approval.

## Repository and active work

Repository: https://github.com/cosmlool/Misty-Isles

Known Stage 29 branches:
- `stage29/playwright-eyes-foundation` — current audit/browser-QA working branch; PR #14 is open and marked Draft.
- `stage29/pvp-rules-implementation` — separate PvP branch. Its `server/src/pvpOperations.ts` currently matches the foundation branch (blob SHA `efb35a686c6a74d20d4997909606c62df2e5640b`).

PR #14: https://github.com/cosmlool/Misty-Isles/pull/14
- Goal: full audit of server operations, persistence, economy, inventory, crafting, auction, clans, PvP, expeditions/dungeons, auth, and UI.
- PR description says a previous CI run had 72/73 server tests pass; the failing expedition test was corrected to wait for the normal `expeditionState` message and persisted file.
- Full CI for the latest PR head is still NOT CONFIRMED. Do not call it green.
- PR remains Draft; `main` must not be changed without approval.

Latest relevant commit discovered in repository history: `770f7361827d92743c49dc8621955e07379b8d76` — adds process-crash recovery coverage for clan WAL transactions. This is a verified commit, but the connector did not expose the exact current branch HEAD SHA; re-resolve branch HEAD before making further code changes.

## Verified by source inspection (not a claim that tests were run locally)

### Browser QA
Branch: `stage29/playwright-eyes-foundation`
- `e2e` uses Playwright 1.56.1, Chromium/Chrome, ports 5173 and 2567.
- Browser checks cover guest login, all four races, character creation, starting inventory, reconnect persistence, expedition hunt and victory, shop purchase (130 gold), equipping, persistence after reload, 17 main tabs at 390px, admin screen render, and uncaught page errors.
- The test server uses a temporary data directory and synthetic accounts; the test-only 1-second expedition search timer changes only a copied `forgotten_lands.json`.
- The README has a numbering gap (11 to 13); documentation-only issue.
- Browser tests have NOT been confirmed as executed successfully in this audit session.

### Server test inventory
The branch `server/package.json` test script lists 29 test files:
`jsonPersistence`, `inventoryOperations`, `playerJson`, `playerSaves`, `auctionTransactions`, `clanTransactions`, `auctionOperations`, `craftingQueue`, `craftingRuntime`, `economyRuntime`, `clanWarOperations`, `clanWarRuntime`, `pvpOperations`, `pvpRuntime`, `guestActionsRuntime`, `duplicateSessionRuntime`, `dailyStreakRuntime`, `calendarOperations`, `prototypeKeysRuntime`, `expeditionSafetyRuntime`, `expeditionOperations`, `dungeonAttemptsRuntime`, `raceEquipmentRuntime`, `authLogoutRuntime`, `authAccountRuntime`, `groupTravelPersistenceRuntime`, `groupDungeonRuntime`, `questRewardsRuntime`, `clanBroadcastRuntime`.
These are present in the script; this is not proof all 29 pass.

### PvP — inspected implementation
Files:
- `server/src/pvpOperations.ts`
- `server/test/pvpOperations.test.ts`
- `server/test/pvpRuntime.test.ts`
- `server/src/index.ts` handlers `pvpList` / `pvpChallenge`

Observed rules:
- Attacker cooldown: 15 minutes.
- Victim immunity: 60 minutes.
- Winner steals 20% of the loser's current gold (floor).
- Offer contains up to four real saved characters.
- Current code also restricts level difference to ±2 and excludes characters with active immunity.
- Server validates that a real-player target is in the attacker's offered list.
- Runtime test seeds offline saved characters and checks four offered real opponents, 20% transfer, saved cooldown, victim immunity, and exclusion during immunity.
- Combat is still a combat-rating comparison; report fields `damage` and `received` are zero. This matches the old passport note; do not silently convert it to HP combat.
- Known bot IDs are still accepted directly by `pvpChallenge`, although `pvpList` currently builds its list from saved characters. Review whether this legacy training-bot path is intentional and whether it should remain accessible.
- User's previously confirmed design: PvP on a 15-minute cadence; the candidate pool may include all registered characters; show four opponents; player chooses one; 20% gold transfer. The current ±2-level restriction conflicts with the stated all-registered-characters pool and must be treated as a mismatch to correct, not as an approved design rule. Immunity exclusion remains a separate protection rule.

### Clans and clan wars
- `clanTransactions.ts` uses a write-ahead transaction journal for player, clan, war, and territory snapshots.
- Commit `770f736...` adds a process-crash test that exits after a partial target write, then verifies recovery from the journal.
- The transaction writes the journal atomically, then atomically replaces the four target JSON files sequentially; startup/next commit recovery replays the snapshot and removes the journal.
- Recovery fails closed and retains an unreadable journal rather than silently deleting it.
- Durability limitation: implementation uses write + rename but does not call `fsync` on the journal/target files or containing directory. Existing test proves a child-process termination between writes, not sudden power-loss durability. Decide whether process-crash recovery is the intended guarantee or whether stronger disk-flush guarantees are required.
- Snapshot validation checks top-level object/array structure and object-valued entries, not the full domain schema of every player/clan record; upstream persistence validation remains important.
- `clanWarRuntime.test.ts` covers donation, per-player attack cooldown, cumulative damage, score broadcast, expiration settlement, one-time reward, and disband cleanup.
- `clanWarOperations.ts` currently defines a 1-second clan-war attack cooldown. Verify whether this is intentionally test-build timing or an unintended live gameplay value before public release.
- Expired wars settle on a later request, not via an independent timer.

- `clanTransactions.ts` uses a write-ahead transaction journal for player, clan, war, and territory snapshots.
- Commit `770f736...` adds a process-crash test that exits after a partial target write, then verifies recovery from the journal.
- `clanWarRuntime.test.ts` covers donation, per-player attack cooldown, cumulative damage, score broadcast, expiration settlement, one-time reward, and disband cleanup.
- `clanWarOperations.ts` currently defines a 1-second clan-war attack cooldown. Verify whether this is intentionally test-build timing or an unintended live gameplay value before public release.
- Expired wars settle on a later request, not via an independent timer.

### Expeditions and dungeons
- Group travel persistence runtime test covers saving group travel start/claim for every member.
- Group boss-dungeon runtime test covers win rewards and loss costs for every participant.
- Solo dungeon runtime test covers remaining daily entries and the three-entry cap.
- Full group membership reconstruction after disconnect/restart remains unimplemented; orphaned active actions are safely reset. This remains open.

#### Additional dungeon source inspection (server/src/index.ts, lines 502–536)
- Group boss-dungeon entry requires the leader to start it, every member online, each member at the dungeon minimum level, and each member below the daily cap of three attempts.
- Attempt count and battle count increment for every participant before the win/loss branch; losses consume an attempt and give no rewards.
- Group success applies HP loss, healing/passives, XP, gold, activity records, boss/victory counters, combat history, and one persisted snapshot of all participating players. Base dungeon gold is divided with `Math.floor(dungeon.gold / groupSize)`; any remainder is not distributed.
- Group drops include one guaranteed resource and optional boss drops; each item is assigned randomly to one group member. Confirm whether this random per-item distribution is intended.
- Group failure applies health loss, records activity and combat reports, consumes attempts, and persists the group members together.
- Solo dungeon attempts increment before the outcome; wins award XP/gold/resources and random bonus materials/equipment; losses award no loot and still consume an attempt.
- The dungeon handler has no explicit request/idempotency key. The client includes `dungeonRun` in its `guardedActions` set and blocks a second click while the action is pending (with an 8-second fallback timeout). This reduces accidental double-clicks in the official UI, but the server itself still treats a second distinct message as another valid run and consumes another daily attempt. Confirm whether that is acceptable for direct/custom clients; no duplicate reward bug is proven.
- No definite dungeon exploit is confirmed from this source read alone. Runtime coverage still needs execution on the exact branch snapshot.

- Group travel persistence runtime test covers saving group travel start/claim for every member.
- Group boss-dungeon runtime test covers win rewards and loss costs for every participant.
- Solo dungeon runtime test covers remaining daily entries and the three-entry cap.
- Full group membership reconstruction after disconnect/restart remains unimplemented; orphaned active actions are safely reset. This remains open.
- Dungeon rewards, duplicate/replay requests, balance, and edge cases still require deeper audit.

### Public-launch blockers / design decisions
- Test admin handler remains openly callable in the inspected server source. Restore server-side authorization/allowlisting before public deployment.
- Full CI for current branch head remains unconfirmed.
- Full group restoration after disconnect/restart remains open.
- Dungeon reward/replay/balance/edge-case audit remains open.
- `statPoints` allocation design remains undecided.
- Clan-war auto-settlement timer remains a design/implementation follow-up.
- PvP ±2-level matching and direct bot challenge path require explicit review.

## Current audit progress

Status: ongoing; source review and test inventory inspection only. No local test suite was executed in this session.

Completed evidence collection in this checkpoint:
- [x] Confirmed known active Stage 29 branch names.
- [x] Read PR #14 current description/state (open, Draft).
- [x] Read browser QA README, Playwright config, and main smoke test.
- [x] Read branch server test script (29 test files listed).
- [x] Read PvP operations and runtime test assertions.
- [x] Read clan-war operation logic and runtime assertions.
- [x] Read clan transaction WAL implementation and process-crash recovery tests.
- [x] Read group travel, group dungeon, and solo dungeon test sources.
- [x] Inspected PvP/admin handlers in server source.
- [x] Inspected solo and group dungeon handlers, reward distribution, attempt accounting, and persistence paths.
- [x] Created and extended the audit checkpoint in `stage29/playwright-eyes-foundation`; its complete history is in that branch. Re-resolve the branch tip on resume rather than relying on a chat transcript.
- [ ] Resolve exact current HEAD SHA for the separate PvP branch.
- [ ] Confirm full CI for the current PR head.
- [ ] Run full server tests and client/server builds locally from the same branch snapshot.
- [ ] Continue systematic handler-by-handler audit of all game systems.
- [x] Checked client pending-action guard for `dungeonRun`; official UI blocks repeated clicks while pending. Server-side request idempotency remains absent and should be considered separately.
- [ ] Finish dungeon reward/replay/edge-case audit, including whether random group loot distribution and lost remainder from divided group gold are intended.
- [ ] Correct the PvP candidate pool to honor the user's stated all-registered-characters requirement; review legacy bot direct-challenge path separately.
- [ ] Verify admin handler authorization before public release.
- [ ] Produce final audit report before gameplay changes.

## Next action

Resolve the current branch heads and CI first. Then continue the handler-by-handler audit from dungeon reward/replay flows and the remaining server handlers. Do not rerun already-passing local checks unless the tested commit changed or the result is missing.


## Continuation audit — 2026-11-09 (verified PR head)

- PR #14 head is now resolved exactly: `95d3e03dd2b1c1d832994c00777e81c9229ad2ab`; base `main` at `559ccb2ea7f7d8b676e39b05d6d63f22f1f725e0`. PR remains open and Draft. The head is the checkpoint-document commit; do not infer it has run the full game tests.
- GitHub Actions workflow-run lookup and combined commit status for this exact head returned no runs/statuses. CI therefore remains unverified, not green.
- Re-read auction operation/transaction code and the auction operation/runtime tests. Source shows list/cancel/buy are snapshot-based; journal replay restores players, lots, and history; the live runtime test covers concurrent buyers, offline seller, withdrawal, restart persistence. These are source/test-coverage observations only; tests were not executed in this chat.
- Re-read crafting queue and live runtime test. Material removal is validated and copied into the job; claim removes a completed job from the queue, and unique-amulet conflict refunds materials or retains the job if safe refund data is unavailable. Runtime coverage inspected for starting a craft job; no local execution.
- Re-read quest reward handler and `questRewardsRuntime.test.ts`. One-time story/faction/daily/achievement claim guards are present and the runtime test asserts no duplicate rewards. Additional weekly edge case identified for follow-up: weekly progress (`challengeWeek` / `weeklyHunts`) is rolled forward only during a successful hunt, while the weekly claim key is derived from the stored `challengeWeek`. If a new ISO week begins and the player claims before their first hunt of that week, the handler still evaluates the previous week's counter/key. This can allow a late claim for the previous week's unclaimed progress; it does not establish a duplicate payout, but the intended expiry/claim-window behavior is unclear. Add a boundary test and decide whether to roll the week at claim time.
- Confirmed the admin handler at `server/src/index.ts` line 796 still has no `requireCharacter` or operator allowlist check and directly grants currency/XP/items/stats. The nearby comment explicitly describes it as open for the Stage 28 test build. This remains a hard public-launch blocker; do not expose the build publicly until server-side authorization or removal is implemented.

### Next audit actions
- Continue handler-by-handler review of account/session authorization and remaining reward/expedition flows; verify the admin path against deployment configuration.
- Add a weekly-challenge ISO-week rollover test to the audit backlog; do not change reward behavior without deciding whether late claims are intended.
- Continue economy/crafting review for numeric overflow and malformed legacy state; no exploit is confirmed from the reviewed snippets.
- Run full server tests and client/server builds only after the exact branch snapshot/dependencies are available locally; do not mark any tests passing based on source inspection.


### Authentication source review — 2026-11-09

- Inspected `server/src/index.ts` auth HTTP routes and `client/src/main.ts` guest identity flow. Passwords are stored as scrypt hashes with per-account random salts; session tokens are 32 random bytes and only their digest is persisted; sessions expire after 30 days; room join verifies token/player ID and rejects a second concurrent session for the same character.
- Auth endpoints (guest/register/login/logout) have an in-memory limit of 10 requests per 15 minutes per `remoteAddress`; expired counters are periodically pruned. This is process-local and may need proxy-aware/client-aware handling for a multi-instance deployment, but no bypass was proven from source inspection.
- Guest IDs are generated client-side with `crypto.randomUUID()` (fallback: 16 random bytes) and stored in localStorage. `/auth/guest` issues a fresh session for any syntactically valid, unlinked supplied player ID without requiring a previous guest token. This makes the guest ID itself a bearer credential: high entropy makes blind guessing impractical, but anyone who learns the ID can request a new session. Review whether this trust model is intentional; safer reconnect would require a proof token for existing guest saves and let the server mint IDs for new guests.
- Registration with an existing guest character requires a valid guest token and removes the prior guest sessions when linking. No definitive password/session vulnerability was confirmed in this limited source review.


### Expedition/group progression audit — 2026-11-09

- Re-read group invitation/acceptance/leave, expedition search start/claim, travel start/claim, and the expedition safety/runtime and operations tests.
- Confirmed useful protections: group size capped at 3; group membership cannot be changed during a recorded search/move; search claim is leader-only and checks every online participant has matching searching state, group ID, zone, and end timestamp; travel claim checks participant route/group consistency and waits for the latest participant completion timestamp; orphaned group search state is reset on reconnect.
- **Confirmed progression-consistency gap:** group search start validates that members share the same current zone and meet its minimum level, but it does not require their opened, cleared, or seen[zone] progress to match. Search claim then chooses the encounter using only the first (leader's) member's seen and cleared state, and on victory writes the resulting seen/cleared/opened progress to every member. Therefore a member with less zone progress can be advanced by the leader's state, or members with more progress can be evaluated using the leader's less advanced state. This is a confirmed source-level consistency/design bug; no runtime exploit test was run. Add tests for mismatched progress before choosing a policy (require equal progress, or compute safe per-member progression explicitly).
- **Secondary guard gap to test:** expeditionTravelStart checks the leader is not already searching/moving and verifies each participant's current zone/opened route, but the participant loop does not explicitly reject a participant whose own expedition state is already searching or moving. The normal group lifecycle should prevent this, but corrupted/legacy/inconsistent state could be overwritten. Add a runtime test and enforce all participants idle before starting travel.
- Search start/claim uses one shared end time and persists all members; the UI message says 15 minutes while actual duration comes from EXPEDITION_DATA.searchSeconds. Keep the configured value and user-facing text synchronized; test fixture overrides searchSeconds to zero only in its temporary data directory.
- Existing expedition safety runtime coverage includes orphan cleanup, group invitation lock during active search, successful group rewards and stats, and disconnect cancellation. It does not assert equal progression requirements or mixed-progress handling.
- No gameplay code was changed. These findings are added to the audit backlog for a planned fix after the complete audit.


### Reward and progression continuation — 2026-11-09

- Re-read `server/src/index.ts` reward handlers and the calendar/quest runtime test sources.
- Confirmed UTC ISO week calculation is implemented in `calendarOperations.ts` and its unit tests cover Monday boundaries and ISO week-year transitions (including 2020-W53 / 2021-W01).
- Confirmed daily reward streak uses UTC calendar dates; the runtime test covers consecutive-day increment, missed-day reset, same-day duplicate rejection, gold, and potion persistence.
- Confirmed race daily claims reset by UTC date and race, check required level/progress, record the claimed quest ID before granting gold/XP/reputation. Existing quest runtime tests cover story/faction/daily challenge/achievement duplicate claims, but do not cover race-daily claims.
- **Weekly challenge rollover gap reconfirmed in current source:** successful hunt updates `challengeWeek` and resets `weeklyHunts`; weekly claim uses the stored `challengeWeek` without first comparing it to the current `utcIsoWeekKey()`. If the week changes before the player hunts again, the old week's progress and claim key remain active. Whether late claims should expire is a game-design decision, but the handler currently has no explicit week-boundary policy. Add a runtime test for an unclaimed completed weekly challenge across ISO-week rollover before changing behavior.
- The current `questRewardsRuntime.test.ts` exercises the daily challenge and duplicate payout, but not weekly rollover; `calendarOperations.test.ts` tests the pure week-key helper only. This is a coverage gap, not a passing runtime proof for weekly claims.
- Stat allocation remains as previously recorded: `upgradeStat` spends gold directly and does not consume `statPoints`; intended design is not yet decided.
- No gameplay code changed and no tests were executed during this source review.


### Server message authorization sweep — 2026-11-09

- Scanned all 76 `this.onMessage(...)` handlers in the current `server/src/index.ts` snapshot.
- The unguarded handlers are predominantly read-only/public payloads (catalog, dungeon list, market list/history, public clan/territory/war lists, own expedition/combat history), plus `createCharacter` which is intentionally the pre-character entry point.
- `craftQueue` is currently unguarded, but its `finishCraftJobs` helper is an empty no-op and the handler only returns the caller's own queue. No state mutation or exploit was confirmed from this path.
- Group/friend/expedition mutating handlers inspected in this sweep use `requireCharacter`; the multi-line `hunt`, `clanLeave`, and `clanWarAttack` handlers also contain the guard on the following line.
- **Admin remains the exception:** `admin` directly mutates the caller's character and has no character or operator authorization check. This conflicts with the file-level comment saying administrative commands are disabled unless operator IDs are allowlisted. The handler's own comment still says it is intentionally open for the Stage 28 test build. Treat as a public-launch blocker until actual server-side allowlisting/removal is implemented and tested.
- This was a source-level sweep only; no tests were executed.


### Economy / equipment continuation — 2026-11-09

- **User decision: weekly challenge rollover is an error.** Required behavior for the later fix: at weekly claim time, compare the stored `challengeWeek` with the current `utcIsoWeekKey()`. If they differ, roll the challenge to the current week, reset `weeklyHunts` to 0, and do not grant the previous week's reward. Add a runtime test where a player has 15 old-week hunts, the ISO week changes, and a claim is attempted before any new-week hunt; assert no gold/XP is granted and the new-week counter is zero. Also test the normal current-week claim and duplicate rejection.
- Re-read `upgradeStat`, `buyItem`, `equipItem`, `unequipItem`, `enhanceEquipment`, `upgradePendant`, `upgradeSetMastery`, `identifyEquipment`, `salvageItem`, `openChest`, `upgradeBuilding`, `professionSkill`, and `guildSkill` source paths.
- Inventory removal helpers validate array/object structure and preserve an equipped duplicate when another copy is discarded; salvage also blocks dismantling the last equipped copy. Client sends item ID and expected stack count for discard/salvage/chest operations, and the server checks those values before mutating. Existing `raceEquipmentRuntime.test.ts` covers rejection of another race's equipment and acceptance of own-race equipment; it was inspected, not executed.
- **Confirmed client/server profession mismatch:** shop purchase allows an item's profession when it matches `activeSubclass` / `subclassProfession` as well as the base profession, and the client gear catalog uses the same active-profession allowance. The server `equipItem` handler checks only `item.profession !== p.profession`. A character using a subclass can therefore be allowed to buy/see subclass equipment but rejected when trying to equip it. Add a runtime test for a subclass-only item before fixing; align equip validation with the established active-profession rule.
- **Confirmed malformed nested-state hardening gap:** `playerSaves.loadPlayers()` validates that the save root and each player entry are objects, while `readPlayerObject()` validates only that nested JSON parses to an object. Numeric values inside parsed objects are not validated. In particular, non-numeric persisted `equipmentEnhancements[slot:item]`, `collections.pendantLevels[id]`, or `collections.setMastery[setId]` values can flow through `Number(...)` and clamp expressions as `NaN`; the corresponding handlers can then write NaN-derived values/costs back into player state. JSON serialization turns NaN into null, potentially corrupting progression/economy state. Treat as a save-data validation/normalization issue; add malformed-legacy-state tests and fail safely before spending currency.
- `upgradeStat` currently spends gold directly and increments a stat; it does not consume `statPoints`. This remains an unresolved design choice, not a confirmed defect.
- `upgradePendant` currently accepts an owned pendant in inventory or the equipped slot despite its notice text saying to equip it first; verify intended UX before changing.
- `upgradeSetMastery` requires five pieces of a non-legacy set to be equipped and charges gold/materials; `identifyEquipment` requires an equipped item, crystals, and materials; `professionSkill` separates one-time unlock from subsequent cooldown-based activation. No duplicate reward or currency exploit was proven in these inspected paths.
- No gameplay code changed and no tests were executed during this source review.


### Combat / equipment / profession-buff audit — 2026-11-09

Source snapshot: PR #14 branch head `60b593b1c1b6fade83816d17fb7fca3e0354b7d5`. Read `server/src/index.ts`, `server/src/PlayerSchema.ts`, `server/data/equipment_catalog.json`, `server/package.json`, and `server/test/raceEquipmentRuntime.test.ts`. Findings are source-level; no tests were executed.

- **Confirmed combat-stat inconsistency across modes:** `effectiveMaxHealth` reads health bonuses from all five armor slots (armor, helmet, gloves, boots, cloak), and group boss-dungeon stats iterate all five slots. In contrast, ordinary hunt and solo dungeon calculations read only `eq.weapon`, `eq.armor`, and `eq.amulet`. The current equipment catalog contains 57 pieces for each of helmet, armor, gloves, boots, and cloak (plus weapons and amulets). As a result, defense/attack values on helmet, gloves, boots, and cloak do not affect ordinary hunt or solo dungeon combat, even though these items are equippable and their stats are used in group boss dungeons. This is a confirmed gameplay inconsistency.
- **Confirmed equipment-property coverage gap:** `identifyEquipment` permits identifying any of weapon, armor, helmet, gloves, boots, cloak, or amulet. Ordinary hunt reads rare properties only from the weapon and armor slots; solo dungeon reads them only from weapon and armor; group dungeon does not apply equipmentProperties in its stat calculation. Rare properties assigned to helmet/gloves/boots/cloak therefore do not contribute to the reviewed combat paths. The amulet uses its separate effect logic.
- **Confirmed five-piece set counting mismatch:** new armor sets are generated from five armor pieces, but hunt and solo dungeon `setPieces` count only `[eq.weapon, eq.armor, eq.amulet]`. Thus a set made of helmet/armor/gloves/boots/cloak cannot reach the 2-piece threshold in those modes. Group dungeon counts all `Object.values(eq)`, so it can activate those sets there. This is another mode-to-mode inconsistency.
- **Confirmed set-bonus interpretation mismatch to resolve:** generated catalog set descriptions encode tier-specific effects (e.g. 2/5 HP, 3/5 defense, 4/5 resistance, 5/5 HP). Group dungeon currently derives one generic effect from the item's profession and applies `count * 1%` to that single attack/defense/crit/lifesteal/loot value; it does not parse or apply the catalog's tier descriptions. Hunt uses fixed 8% attack/defense or +6% crit for any matching legacy set and has no equivalent five-piece tier calculation. Treat exact intended tier semantics as a design clarification, but the three combat modes are demonstrably inconsistent.
- **Confirmed profession-skill duration mismatch:** profession skill descriptions say bonuses apply in the next battle, but `professionSkill` stores a single `p.buff` until `Date.now() + 5 minutes`. Hunt checks the buff on every battle while it remains active; it is not consumed after one fight. The skill cooldown is 60 seconds, so a later skill activation can overwrite the existing single buff.
- **Confirmed ineffective profession skill:** Vampire skill `blood_burst` is configured with effect `lifesteal`, value 0.08, and a description promising attack/lifesteal in the next battle. The hunt calculation has no `buff === 'lifesteal'` handling in attack or post-victory healing; it only applies lifesteal from the amulet/equipment properties and the character's baseline Vampire profession. Thus the skill's stored buff does not implement its advertised additional lifesteal.
- **Confirmed dungeon buff omission:** solo and group dungeon stat/reward calculations do not read `p.buff` / `buffUntil`. Profession and paid/tribal buff effects used in hunt therefore do not carry into dungeon battles. Whether that is intended needs a clear rule, but the modes currently differ.
- Ordinary hunt's combat report lists only weapon, the legacy `armor` slot, and amulet; it omits the other four equipped armor slots. This compounds the observability problem for players.
- `server/package.json` contains no dedicated ordinary-hunt combat runtime test. The inspected `raceEquipmentRuntime.test.ts` verifies race restrictions only; it does not test combat-stat contribution, five-piece set bonuses, or profession buffs. These findings need focused runtime tests once the audit is complete.
- No gameplay code changed. No local test suite or browser test was run.

#### Follow-up test requirements
1. Equip one item with non-zero defense/attack in each of helmet, gloves, boots, and cloak; assert that ordinary hunt, solo dungeon, and group dungeon all include those contributions consistently.
2. Identify an item in each armor slot and assert its property affects the intended combat calculation.
3. Equip 2/5, 3/5, 4/5, and 5/5 of a generated set; assert the documented tier bonuses in each applicable combat mode.
4. Activate each profession skill; assert its exact effect, whether it is one fight or timed, whether it is consumed, and whether cooldown/overwrite behavior is intentional. Include Vampire `blood_burst`.
5. Explicitly define whether timed buffs affect solo/group dungeons, then test that policy.


- **Additional confirmed profession-buff value mismatch:** the skill catalog stores individual `skill.value` values and descriptions, but activation persists only the effect name in `p.buff`; hunt then hardcodes generic multipliers. Examples: Mage skills promise +18% attack/defense but hunt applies +15%; Warrior `shield_wall` promises +22% defense but hunt applies +15%; Archer `eagle_eye` promises +15% crit but hunt applies +12%; Gatherer `deep_sense` promises +25% loot but hunt applies +20%; Gatherer `orebreaker` promises +12% attack but hunt applies +15%. Some skills are overpowered, others underpowered, and the configured per-skill values are discarded. This is a confirmed implementation/data mismatch, separate from the duration/consumption issue above.
- The shared `p.buff` field also means different effects cannot coexist: paid buffs, racial-guild skills, and profession skills overwrite one another. Whether the intended design is one active buff or multiple independent effects needs to be decided; current overwrite behavior is a source-level fact.


### Faction, regional event, daily quest and PvP cross-check — 2026-11-09

Source snapshot: branch head `85dd8f3a161981412fdef92cc8251b95eab86b15`. Read current `server/src/index.ts`, `server/src/calendarOperations.ts`, and `server/test/questRewardsRuntime.test.ts`. Source review only; no tests executed.

- Story chapters, faction story chapters, faction maximum-rank rewards, daily/weekly challenge claims, generic quest claims, achievements, return rewards, and race daily claims all persist through the common `notice()` -> `save()` path. Existing quest runtime test covers duplicate story/faction/daily challenge/achievement claims, but it does not cover race daily claims or ISO-week rollover.
- Race daily state is reset when UTC date or race changes. Hunt-win and zone-win progress increments only on successful hunt; mining progress increments on successful mine. Race daily claim records the ID before granting gold/XP/reputation. No race daily duplicate-claim defect found by source review. Add dedicated runtime coverage for all four races, daily reset, claim idempotency, and restart persistence.
- Regional events rotate by UTC day through four configured entries. All active event zones currently share a +20% multiplier to both gold and XP, +0.012 boss encounter chance, and an independent 35% chance to award the event resource. They also grant faction event progress and up to +2 faction reputation per victory, capped at +10 per faction per UTC day. The event-specific descriptions emphasize different benefits (XP/reputation, gold/feathers, XP/rune shards, or stronger bosses/relics), while the implementation applies the common bonus to every event. Treat as a design/text consistency question unless intended event-specific multipliers are specified; do not classify as a confirmed defect yet.
- **PvP user requirement remains unmet in current server code:** both `pvpList` and `pvpChallenge` filter/validate real players at level difference ±2. User explicitly approved that all registered characters can appear as potential opponents, with four presented choices. The ±2 restriction must be removed or replaced only by a user-approved rule in the PvP implementation branch. Do not change now during audit.
- PvP also remains a rating comparison rather than a full HP/damage battle; report fields `damage` and `received` are zero. It ignores timed profession buffs and only uses weapon, legacy armor, and amulet for its reviewed stats; this is part of the cross-mode combat inconsistency already documented. User has not requested conversion to HP combat, so leave as design question.
- Normal hunt win/loss both persist through `notice()`; health regeneration is ticked every second in room memory and its timestamp/state is persisted on later save/disconnect. No definite save-loss defect confirmed in this pass.
- No gameplay code changed. No test suite was run.


- **Confirmed racial guild skill value mismatch:** `GUILD_SKILLS` defines per-skill values, but hunt applies hardcoded generic multipliers by effect. Examples: Cat `arcane_burst` is configured as +18% attack but hunt's `attack` buff applies +15%; Dog `iron_guard` is configured as +20% defense but hunt's `defense` buff applies +15%; Rodent `blood_pact` promises +10% attack but maps to `attack` and receives +15%. Other skills happen to match the hardcoded value. Add tests for every racial guild skill and use the configured value as the calculation source.


- **Confirmed weapon-profile bonuses are mode-specific:** the new equipment catalog contains 50 weapons with a `primaryAttribute` bonus and 21 with an explicit `N% к профильной эффективности` effect. `weaponProfile()` parses these values, but its only call sites are group boss-dungeon stat calculation and expedition search combat; ordinary hunt and PvP do not call it. Thus these catalogued weapon bonuses do not affect ordinary hunt or PvP, despite being shown as weapon properties. Verify the intended modes and add cross-mode tests before unifying calculations.


- **Confirmed inert legendary armor effects:** the equipment catalog contains 35 profession-specific legendary armor pieces (five per profession) with explicit numeric effect text, e.g. +8% magic damage, +10% maximum HP, +5% crit, +8% physical defense, +8% production speed, +8% boss damage. The server's only parser for the catalog `effects` string is `weaponProfile()`, which receives only the equipped weapon. No server combat/economy path reads an armor item's `effects` string or applies those armor-specific percentages. The armor's flat `attack`/`defense`/`health` fields are separate and may still apply in some modes, but the advertised legendary special effects are inert. Add a test for each effect family and decide which game modes should receive them.


### Forgotten Lands monster mechanics audit — 2026-11-09

Read `server/data/forgotten_lands.json` (100 monsters, 10 zones, 4 expedition dungeons) and the complete `expeditionSearchClaim` handler in `server/src/index.ts`. Source/data validation only; no runtime tests executed.

- **Confirmed incomplete monster passive implementation:** the data defines 63 distinct `passiveDescription` values. The current expedition combat handler recognizes only 20 description patterns (profession/type resistance, a limited group-attack bonus, and two target-class bonuses). The other 43 descriptions have no corresponding parser/effect in this handler. Examples include monster healing, dodge, first-attack bonus, conditional attack at HP thresholds, poison, critical damage modifiers, defense/accuracy effects, debuffs and special resistances. These are displayed as monster passives but do not affect the reviewed combat formula.
- **Confirmed unused monster combat fields:** `monster.defense` and `monster.speed` are only read for the combat report in the reviewed expedition handler; neither affects rounds, player damage, incoming damage, or encounter outcome. Monster HP and attack are used. Whether defense/speed were intended as informational fields or actual combat mechanics must be decided, but current displayed values do not affect this battle.
- **Confirmed unsupported weakness entry:** 99/100 monsters use profession aliases in their `weakness` string and are parsed by the current code. One monster (`FL-04-10`, Сторож гнилого дерева) has `Огненный урон +25%`; the current parser compares only player profession aliases, so this weakness never activates. There is no player elemental-damage type in the reviewed calculation.
- All 100 monster references point to configured zones; all monster drop IDs resolve to `EXPEDITION_DATA.dropItems`; all four expedition dungeon boss IDs and resource IDs resolve. No broken monster/drop/dungeon data references found in this validation.
- Group expedition divides monster gold by `Math.floor(monster.gold / groupSize)`; any remainder is discarded. Same behavior exists in group boss dungeon. Confirm whether this is intentional or should be distributed.
- Group expedition currently calculates the shared drop chance using the highest applicable loot bonus among all participants, then randomly assigns each successful drop to one participant. This is a design choice requiring confirmation; no duplication exploit identified.
- Existing group progress mismatch bug and travel idle-state guard gap remain recorded above. No gameplay code changed.


- **Further confirmed solo legacy dungeon omissions:** the four legacy `DUNGEONS` have no `bossId` and use a separate `dungeonRun` formula. It reads only weapon, legacy armor and their enhancements/properties. It does not apply helmet/gloves/boots/cloak stats, amulet effects, `weaponProfile()`, equipment-set bonuses (a local `setCount` helper is declared but never called), or timed `p.buff` effects. The newer boss dungeons use a different formula and do apply five armor slots, some sets, weapon profiles and selected pendant effects. This confirms another mode-to-mode mismatch.
- **Confirmed group boss-dungeon boss-data omissions:** `runExpeditionDungeon` uses `dungeon.power` as its scaled encounter difficulty and `boss.attack` for incoming damage. It does not use the referenced boss monster's `hp`, `defense`, `speed`, or `weakness`; only two passive-description patterns (physical/magic damage reduction) affect the formula. The boss's other passive descriptions are not applied. Whether the dungeon's separate `power` is intentionally authoritative is a design question; the current boss data fields are otherwise report/catalog data in this path.


- **Confirmed pendant level-100 discontinuity:** `pendantEffectValue()` returns `rate * level` for levels 1–99, but switches to a separate cap value at exactly level 100. For XP, 0.005 × 99 = 49.5% and cap is 50% (continuous). For defense/crit, 0.0005 × 99 = 4.95% but level 100 returns 10%; for health/loot/gold/production/regen/reputation/bossDamage/crystalChance, 0.001 × 99 = 9.9% but level 100 returns 20%. Thus most pendant effects roughly double on the final level. Confirm whether this is an intentional level-100 milestone or a formula bug; add boundary tests at levels 1, 99 and 100.


- **Correction to the earlier subclass/equipment finding:** the server's shop/equip code contains an `activeSubclass` / `subclassProfession` allowance, but the current `PlayerSchema` declares neither field, `applySaved()` copies only declared Player fields, and no server/client handler sets either field. Therefore the subclass purchase/equip mismatch is not reachable through the current gameplay flow as inspected; treat those checks as dead/legacy compatibility code, not as a confirmed active-player defect. Keep the strict base-profession equip rule unless a subclass feature is actually introduced. The earlier entry above should be read with this qualification.


- The four expedition dungeon bosses confirm the passive/weakness gap with concrete data: Rust Captain's group attack/defense bonus is ignored; Last Harvest Keeper's every-third-round healing and archer damage reduction are ignored; Bone Valley King's attack/defense bonus is ignored (only its physical reduction is parsed); Archon of Oblivion's below-30%-HP attack bonus is ignored (only physical/magic reductions are parsed). All four boss `weakness` entries (three Mage, one Archer) are ignored by `runExpeditionDungeon`.


### Client mail / activity-log UI audit — 2026-11-09

- **Confirmed incomplete mail UI:** the client `mail` tab is built from `quests.activityLog`, not the `PlayerSchema.mail` field; no server `mail` message handler or mail persistence workflow exists. The page is therefore an activity-log viewer presented as a mailbox.
- Category filtering and checkbox selection work locally, but `Прочитать все` only displays a toast and does not mark/save entries; `Удалить прочитанные` has no click handler at all. `read` flags are not written by `recordActivity()`. These are visible but non-functional controls.
- The battle-report opener reads the activity log entry, not the full `combatHistory` report, and its own UI text acknowledges that equipment snapshots are not available there. Full combat reports are stored separately in `quests.combatHistory`.
- Treat this as an incomplete feature/UI consistency item, not a server economy exploit. Decide whether to implement real mail (inbox/outbox, read/delete state, server actions) or rename/reduce the page to a read-only activity journal.


### Clan weekly season ranking audit — 2026-11-09

- **Confirmed UI/server season-period mismatch:** the client labels the board `Недельный сезонный рейтинг` and says points are awarded for weekly activities. The server's `clanSeasonBoard()` sorts the persistent `clan.seasonPoints` without any weekly reset or period key. `clanSeasonReward` only gates the claim with `lastSeasonRewardWeek`; it does not reset points or freeze standings at week end. As written, the so-called weekly ranking is cumulative/all-time, while the reward is claimable once during each 7-day epoch window. This means long-lived clans retain historical points indefinitely and a member can claim the current rank before the week closes. Decide whether points should reset on a defined weekly/season boundary and whether rewards are claimable only after that boundary.
- `clanSeasonBoard()` returns only the top 10; clans outside that list resolve to rank 0 in `clanSeasonReward` and receive the default 1,000-gold reward. Confirm whether this is an intentional participation reward.
- The inspected `clanWarRuntime.test.ts` verifies season points after war settlement but has no test for weekly ranking reset, reward timing, or rank-based reward tiers.


### Critical guest-account takeover via public player-ID disclosure — 2026-11-09

- **Confirmed critical security vulnerability:** `POST /auth/guest` accepts any client-supplied player ID matching a 12–64 character alphanumeric/underscore/hyphen pattern and issues a fresh guest session without requiring proof of the existing guest session. Guest IDs are generated client-side as a UUID (or random 16-byte fallback), stored in localStorage, and match this accepted format.
- Multiple public game messages disclose raw internal player IDs:
  - `clanList` sends `leader: x.leader` for every clan.
  - `auctionList` returns active lots containing `sellerId`; lot IDs are generated with the seller's player ID embedded.
  - `marketHistory` returns public transaction history containing `sellerId` and `buyerId`; transaction IDs/lot IDs also embed the seller's player ID. A private auction-history response can disclose the other party's ID to a transaction participant.
  - `broadcastClanOverview` also sends raw leader IDs to clan members.
- **Exploit chain:** an attacker can create their own guest session, read one of these public payloads, call `/auth/guest` with the victim's exposed guest ID, then register/link that guest ID using the newly issued `guestToken`. The register route accepts any valid guest session for that ID and removes prior sessions when linking. This can permanently bind the victim's unlinked guest character to the attacker's account. The duplicate-online-session check only delays direct takeover while the victim is online; it does not prevent the account-linking attack.
- This is a public-launch blocker and should be prioritized above gameplay fixes. Required remediation:
  1. Stop accepting arbitrary existing guest IDs at `/auth/guest`. New guest IDs must be minted by the server; reconnect to an existing guest save must require proof of the existing session/token (or an equivalent server-signed recovery credential).
  2. Remove raw player IDs from all public payloads. Use `publicPlayerCode()`, display names, or booleans such as `isOwnLot`; generate auction lot IDs as opaque random IDs that do not contain player IDs; remove or redact raw IDs from public market/auction history.
  3. Add integration tests proving an arbitrary ID cannot obtain a session, public clan/auction/market responses contain no internal player IDs, and an attacker cannot register/link a victim's guest save using only a disclosed ID.
  4. Consider invalidating/rotating exposed guest credentials and auditing existing unlinked guest saves during deployment.
- No gameplay code or auth code changed during audit. This finding is source-level confirmed; exploit was not executed against a live service.


- The existing `server/test/authAccountRuntime.test.ts` makes the weakness explicit: it calls `POST /auth/guest` twice with the same existing `playerId` and asserts that both requests return 200. It then uses one of those newly issued tokens to link the ID to an account. The test verifies revocation of old tokens after linking, but does not verify ownership proof when minting a session for an existing guest ID. Add a negative test and change this contract; do not preserve the current second-guest-session behavior.
- Account registration does not check `ONLINE_PLAYERS` before linking the guest ID. An attacker can therefore link an exposed guest ID even while its owner has an active room; the current room may continue temporarily, but the owner loses valid guest-session credentials for the next reconnect.


- **Confirmed clan leadership management gap:** `clanLeave` blocks a leader from leaving while more than one member remains and tells them to transfer leadership, but there is no `clanTransferLeader`/leadership-change handler or client control. There is also no leader succession when a leader becomes inactive. Members can leave individually, but cannot assume leadership, so upgrades and new war challenges remain locked to the absent leader. Add a secure leader-transfer/succession flow or change the leave/disband policy.


- **Correction/extension to buff-mode coverage:** a full source search finds only one combat calculation that reads `p.buff` / `buffUntil`: ordinary legacy `hunt`. Expedition search combat, both legacy and expedition boss dungeons, PvP, and clan-war calculations never read the active buff. Thus every timed buff source (paid blessing, chest, racial guild skill, profession skill) is effective only in ordinary hunt, regardless of its advertised duration/next-battle wording. Add an explicit policy and tests for every mode; the prior note naming only solo/group dungeons was incomplete.


- **Additional raw-ID disclosure channel confirmed:** public `clanWarList` sends active war records without redaction. Each war stores `lastAttackAtByPlayer` as a map keyed by internal player IDs (see `recordClanWarDamage()`), and the handler sends that object to any requester as well as clan members. Therefore active clan wars disclose IDs of players who have attacked, in addition to the clan, auction and market disclosures listed above. Strip this internal cooldown map from every client-facing war payload.


### New pendant effect integration audit — 2026-11-09

- **Confirmed new pendant level bonuses are not consistently applied in ordinary hunt:** `hunt` reads raw `amulet.value` for XP, gold, defense and crit instead of `pendantEffectValue(item, pendantLevel)`. Consequently PEN-001 XP stays at its base +0.5% instead of scaling to +50%; PEN-004 gold stays at +0.1% instead of +20%; PEN-005 defense uses raw +0.1% instead of its configured +0.05% per level and does not scale; PEN-008 crit uses raw +0.1% instead of +0.05% per level and does not scale. Health pendant PEN-002 is correctly handled by `effectiveMaxHealth()`.
- **Confirmed new loot pendant is absent from ordinary hunt:** PEN-003 (`effect:'loot'`) is applied to drop chance in both expedition search and group boss dungeon, but ordinary hunt's loot chance only reads weapon/armor properties and profession/buff bonuses; it never reads the amulet's loot effect. Its advertised additional-resource chance therefore does not work in the main hunt.
- **Confirmed crit pendant is misapplied in expedition combat:** both `expeditionSearchClaim` and `runExpeditionDungeon` handle `effect:'crit'` by multiplying attack by `1 + pendantValue * 0.5`. Neither calculation has a crit-chance/critical-hit roll. In ordinary hunt it is added to crit chance, but only at the raw base value. Thus the same crit pendant has different and incorrect semantics across modes.
- PEN-010 boss damage is applied to expedition-search boss/finalBoss and group boss-dungeon attack, but not to ordinary hunt boss encounters. PEN-009 reputation is only used for the one-time `factionChoice` bonus; ongoing faction-event, story, and race-daily reputation awards do not use it. Confirm intended scope.
- PEN-006 production, PEN-007 regeneration, PEN-011 mining crystal chance and PEN-002 health use the level-scaled helper in their respective paths. XP/gold/defense/crit/loot/bossDamage integration needs a single shared calculation and mode policy.
- Data metadata mismatch: PEN-005 and PEN-008 catalog `value` fields are 0.001, while their descriptions and `pendantEffectValue()` rates use 0.0005 per level. The helper currently ignores the catalog `value` for non-legacy pendants, but the duplicate values are misleading and should be normalized.
- Add tests for each of the 11 new pendant effects at levels 1, 99 and 100 across ordinary hunt, expedition search, boss dungeon, mining, crafting, regeneration and reputation. No gameplay code changed.


- **Confirmed new set-effect semantics are inconsistent across combat modes:** the generated set role is `crit` for Assassin/Archer, `lifesteal` for Vampire, and `loot` for Gatherer. In both expedition search and group boss dungeon stat formulas, `crit` and `lifesteal` are converted into an attack multiplier (`1 + bonus * 0.75`); `loot` is also converted into an attack multiplier (`1 + bonus * 0.5`). Both expedition modes separately apply set loot to drop chance and set lifesteal to post-win healing, so these sets provide their advertised secondary effects as well as an unintended attack increase. Ordinary hunt does not count the five-piece sets at all. Confirm intended set roles and implement one shared semantics table.


- **Confirmed paid identification can create inert properties:** `identifyEquipment` allows weapon, armor, helmet, gloves, boots, cloak and amulet. Across all reviewed combat paths, `equipmentProperties` is only read for the weapon and legacy armor slots in ordinary hunt/solo dungeon/PvP/clan-war calculations; expedition search and group boss dungeon do not read it at all. Properties identified on helmet, gloves, boots, cloak or amulet therefore have no effect in any reviewed mode, despite consuming crystals and materials. Either restrict identification to supported slots or implement the property effect for all allowed slots and combat modes.


### Public-repository data protection and local verification audit — 2026-11-09

- **Confirmed public-repository data exposure risk:** GitHub reports this repository is public. The server defaults `DATA_DIR` to `process.cwd()/data`; the Windows launcher starts the server with working directory `server`, so runtime state is written under tracked `server/data` alongside the static JSON catalogs. Runtime files include `players.json`, `accounts.json`, `sessions.json`, `clans.json`, `auction.json`, `auction_history.json`, `clan_wars.json`, `clan_territories.json`, and transaction journals/backups. The current root `.gitignore` is a generic R template and excludes none of these, nor `node_modules`, `logs/`, `*.log`, `.misty-game-processes.json`, `*.bak`, or nested `.env` files. The launcher creates `logs/` and `.misty-game-processes.json`; player saves create backup files. A routine `git add .` after running the game can therefore stage private player/account/session data and local logs for publication.
- No runtime save/account/session files are currently present in the tracked `server/data` directory listing; the risk is from future generated files. Add precise ignore rules for runtime filenames/journals/backups, local logs/process state, dependency folders and nested environment files, while keeping the three static catalogs tracked. Consider moving runtime state to an explicit external `MISTY_DATA_DIR` outside the repository.
- **Local verification script is not the full test suite:** `VERIFY_PROJECT.bat` installs client/server dependencies, runs `tools/qa-audit.mjs`, client `npm run verify:project`, and server `npm run build`, but does not run server `npm test` or Playwright E2E. Its final message says “Verification passed”, which can be mistaken for full verification. Update its name/output or include the missing test commands in a separate full-test script.
- `tools/qa-audit.mjs` checks only root `.env`, `.env.local`, and `.env.production`; it does not scan nested environment files or runtime data files. Extend it to enforce the ignore/privacy policy and fail if runtime state is found in the repository.
- Windows stop script review: `Stop-Game.ps1` correctly terminates only the process trees recorded by this launcher's state file, rather than killing every Node process. No issue found there.
- No source/runtime code changed.


- **Confirmed launcher cleanup gap:** `Start-Game.ps1` starts the server, waits for port 2567, then starts the client and waits for port 5173. The `.misty-game-processes.json` state file is written only after both are ready. If client startup fails/times out after the server is already running, the script throws without stopping the server and without writing the state file; `Stop-Game.ps1` then cannot find the recorded PIDs. Add a cleanup/finally path or write the state file immediately after launching each process.
- Launcher and `VERIFY_PROJECT.bat` treat existence of a `node_modules` directory as proof dependencies are complete. A partially installed or stale directory (e.g. missing `tsx`) is not repaired automatically. Check required executables/packages or provide a clear repair command.


- Historical exposure check: GitHub commit-path history returned no commits for `server/data/players.json`, `accounts.json`, `sessions.json`, `clans.json`, `auction.json`, runtime backups, root `.env`, or `server/.env`. The current risk is preventive; no evidence was found that these runtime files have already been committed.


### Hunt rewards, daily claims, chests, regional events, and reconnect persistence — 2026-11-09

Reviewed current branch source: `server/src/index.ts`, `server/src/PlayerSchema.ts`, `server/src/playerSaves.ts`, `server/test/questRewardsRuntime.test.ts`. Source-level review only; tests not executed.

- **Confirmed regional-event description/implementation mismatch:** all four event definitions advertise different mechanics (Dawn: more XP and reputation; Caravan: more gold and rare feathers; Lore: more XP and rune-shard chance; Eclipse: stronger bosses and rare relics). The common hunt implementation instead applies the same generic +20% reward multiplier to both gold and XP for every event, the same +2 faction reputation per successful hunt (subject to the shared daily cap of +10), and a generic 35% event-resource drop. Event-specific effects are therefore not implemented as described. Event activity also adds +0.012 boss chance to every active event, including those whose descriptions promise different effects. Needs a design decision: implement each advertised event separately or rewrite descriptions to match a shared effect.
- Regional event selection is deterministic by UTC-day index over the four events, not a timed event scheduler. No bug proven if daily rotation is intended.
- Chest opening consumes exactly one indexed `mystery_chest`; it checks optional item ID and expected chest count before consuming, then persists through the normal notice/save path. Loot branches include items, crystals, gold, 10-minute attack/defense buff, and a rare-item pool with duplicate filtering. No chest duplication exploit confirmed in the reviewed path.
- Potion use validates ownership, refuses use at full health, consumes one potion and caps healing at effective max HP. Fountain and daily reward both persist their daily claim markers/rewards through the notice/save path. Daily streak uses UTC date keys and resets to 1 after a missed UTC date; no defect found in the reviewed logic.
- Return bonus is enabled on join after `lastSeenAt` is at least 3 days old; claim is one-time per eligibility flag and additionally enforces a 7-day timestamp cooldown. `onLeave` and save/notice update `lastSeenAt`. No repeat-claim bypass was confirmed in the inspected lifecycle.
- Player persistence is action-driven: mutating handlers generally finish via `notice()`, which calls `save()`; `onLeave` and `onDispose` also save. There is no periodic full-player autosave interval (the room interval only regenerates health). This is not automatically a defect because mutations normally save immediately and leave saves again, but abrupt process termination between an in-memory mutation and the corresponding save remains a durability window. Confirm whether production requires periodic autosave and/or transaction-backed saves.
- `onLeave` and `onDispose` both call save, so normal room teardown may create two successive backups for the same player state. This is backup churn, not a confirmed data-loss bug.
- Quest reward runtime test covers one-time story/faction/daily challenge/achievement claims, but does not cover faction story chapter III event progress, regional event-specific effect values, daily streak boundary cases, return-bonus eligibility, or chest outcomes. Those remain targeted test gaps.
- No gameplay code changed. No tests executed.

#### Follow-up test requirements
1. Assert each regional event's distinct documented effect, boss probability, resource probability, gold/XP/reputation, and daily cap.
2. Test daily streak on consecutive UTC dates, missed UTC date, same-day duplicate, and daylight-saving/local-time boundaries (UTC should remain authoritative).
3. Test return bonus at exactly 72 hours, just under 72 hours, and 7-day claim cooldown; verify reconnects and process restart.
4. Test chest expected-count/index mismatch, duplicate chest requests, every reward branch, and rare unique-item duplicate filtering.
5. Simulate abrupt process termination immediately after a mutation but before save to quantify the durability window; decide if periodic autosave is required.


### PvP / clan-war / social-group continuation — 2026-11-09

Reviewed `server/src/pvpOperations.ts`, PvP and clan-war handlers in `server/src/index.ts`, `server/test/pvpRuntime.test.ts`, `server/src/clanWarOperations.ts`, `server/test/clanWarRuntime.test.ts`, and group-travel runtime coverage. Source-level review only; tests not executed.

- **Confirmed conflict with user's PvP specification:** opponent selection in `selectPvpOpponents`, the `pvpList` response filter, and `pvpChallenge` all enforce a ±2 level range. User explicitly required that all registered characters be eligible, with four randomly offered opponents. The current three independent level checks must be removed or replaced consistently when implementing the agreed rule. Existing `pvpRuntime.test.ts` explicitly expects levels 18–22 for a level-20 attacker and excludes level 23; this test must be updated alongside implementation.
- PvP list correctly selects up to four saved characters, excludes self, uncreated characters and victims under immunity, persists the offered IDs and expires offers at 15 minutes. If fewer than four eligible characters exist, it returns fewer; this is reasonable unless user wants four slots padded with bots.
- **Confirmed bot challenge bypass:** `pvpChallenge` accepts known bot IDs directly without requiring that bot to be present in the offered list and without applying attacker cooldown, victim immunity, gold transfer, or PvP cooldown persistence. Bot fights are treated as free training and do not award gold/XP. Confirm whether direct training challenges are intended to remain outside the 15-minute real-PvP cadence.
- PvP combat is an abstract combat-rating comparison: no HP damage or HP loss is applied, and report fields `damage` and `received` are always zero. This is an established current design, not a defect unless the intended PvP is a full HP-based fight.
- PvP calculation only uses weapon, legacy armor and amulet for stats/properties/set count; other five armor slots are ignored. This is another instance of the combat-equipment inconsistency already recorded above.
- **Potential persistence gap in clan-war attack:** handler increments `p.battles` after a successful clan-war attack, but the path commits only clan/war state and broadcasts; it does not call `persistPlayer` or `save()` for the attacking player in that handler. The battle count may remain only in live room state until a later save/leave. Confirm whether this statistic is expected to persist immediately; add restart test if yes.
- Clan-war attack cooldown is 1 second per player, enforced through persisted `lastAttackAtByPlayer`. The clan-war runtime test intentionally verifies this value. It is far shorter than the 15-minute PvP cooldown but these are separate systems; user has not specified a clan-war cadence. Keep as a design question, not a confirmed bug.
- Clan-war expiry settlement is lazy: it runs when a client requests `clanWarList` or attempts an attack, not on an independent timer. The existing runtime test verifies settlement on list request. No duplicate reward path found in the settlement helper: finished status prevents a second settlement.
- Group invitation/acceptance enforce online participants, friendship or same-clan relationship, maximum three members, leader-only invitations, and lock composition while any member is searching/moving. Existing group-travel runtime test verifies group travel persistence. The previously recorded mixed expedition-progress bug remains outstanding; no new group-travel defect confirmed in this pass.
- No gameplay code changed. No tests executed.

#### Follow-up test requirements
1. Update PvP runtime test to include eligible saved characters at widely different levels and prove four are selected from the full roster (not a ±2 band); challenge one outside the old band successfully.
2. Decide and test whether bots appear in the four offered opponents and whether training challenges should be exempt from the 15-minute cooldown.
3. Verify PvP report and character counters persist across restart for wins and losses, both online and offline victims.
4. Verify clan-war attack increments and persists the attacker's battle statistic immediately, if that counter is meant to include clan-war fights.
5. Keep the 1-second clan-war cadence as a separately documented game-balance decision.


- **Correction to the clan-war persistence note above:** although `clanWarAttack` does not call `persistPlayer` directly, it ends with `this.notice(...)`, and `notice()` calls `this.save()`. Therefore the incremented `p.battles` is saved immediately; this is **not** a persistence gap. Keep a test only if battle-counter semantics need explicit coverage, not because the current handler omits a save.


### Clan reward ranking edge case — 2026-11-09

- **Confirmed clan-season reward rank bug:** `clanSeasonBoard()` sorts all clans but returns only the top 10. `clanSeasonReward` then uses `findIndex(...)+1` on that truncated list. A clan outside the top 10 gets rank `0`; the reward ternary treats every rank `<=3` other than 1 as second/third place, so an unranked clan receives 2,500 gold instead of the intended lower-tier 1,000 gold. Fix by computing rank against the full sorted standings and only truncating the display list, or explicitly treating rank 0 as unranked.
- Clan season week key is `Math.floor(Date.now()/(7*24*60*60*1000))`, which rolls on fixed seven-day intervals from Unix epoch (Thursday UTC alignment), not ISO Monday weeks. No user-defined week boundary is known; record as a design clarification before changing.
- Clan daily quests reset using UTC epoch-day integer and reset shared progress/claims as expected when `ensureClanQuests` is invoked. The UI/claim path calls this helper before presenting or claiming.
- No gameplay code changed. No tests executed.



### Social groups, crafting, tavern, and buff UI continuation — 2026-11-09

Reviewed the current branch's handlers and matching client actions in `server/src/index.ts` and `client/src/main.ts`. Source-level review only; no tests executed and no gameplay code changed.

- **Confirmed group-composition lock bypass:** `huntGroupInvite` and `huntGroupAccept` both reject composition changes while any participant is searching or moving, and the UI explicitly says composition is locked during these actions. However, `huntGroupLeave` has no equivalent active-action check. It unconditionally resets only the departing member's expedition state, removes them from `group.members`, and can transfer leadership while the other members' search/travel remains active. The client also leaves the “Покинуть группу” action available during active search/travel. This allows the group composition and leader to change mid-action, contrary to the other server guards and UI rule. Decide whether leaving should be blocked until completion or should cancel/reset the action for every participant atomically. Add runtime tests for leader and non-leader leaving during both search and travel.
- Crafting UI guards `craft` and `craftClaim` against repeat clicks; server verifies recipe/materials/queue capacity, removes materials when a job starts, and checks finish time before claim. Unique pendant conflict has a refund path. No new crafting duplication issue found in this pass.
- Tavern UI advertises a 47% win chance and a 2x gross payout; server uses the same 0.47 threshold and pays 2x the stake after deducting the stake. Dice and cards currently share the same random mechanic, with different stakes only; this matches the displayed odds, though they are mechanically identical beyond stake size.
- Temple UI's 30-minute duration matches the server's `buffUntil = Date.now() + 30 minutes`. Guild skills and chest buffs use their separately described 10-minute durations. However, the previously recorded combat-mode limitation remains: active buffs are only read by ordinary hunt, not expedition search, dungeons, PvP, or clan wars.
- Clan-war attack increments the player's battle counter and ends through `notice()`, which invokes the normal save path; the earlier suspected missing-persistence issue remains explicitly corrected and is not a defect.
- Friend request/accept flows use public player codes on the wire, verify a pending request, require the other player online at acceptance, and persist both sides' friend lists. Pending requests themselves are in-memory only and disappear on server restart; this is a UX/retry limitation, not a confirmed account or reward exploit.

No local runtime tests were executed. No gameplay code changed.


### Authentication and account-boundary verification — 2026-11-09

Rechecked the current auth HTTP handler, session store, WebSocket join, guest client identity, public player-code resolution, and admin handler. Source-level review only; no tests executed and no gameplay code changed.

- **Confirmed guest-save ownership risk (revalidated):** the browser generates the guest `playerId` locally and stores it in localStorage. `POST /auth/guest` accepts any syntactically valid unlinked ID and issues a fresh 30-day session without requiring proof of a prior guest session. WebSocket join then accepts that session for the matching ID. Therefore possession/knowledge of a guest ID is sufficient to claim an existing unlinked guest save; a leaked ID can be converted into a new session even if the original browser's session token was not stolen. Public player codes are derived hashes and are not the raw ID, so this is a bearer-identifier exposure risk rather than a demonstrated blind remote takeover. Safer design: server-minted guest identity plus a separate persistent recovery secret/proof for reconnect, and require proof before issuing a replacement session for an existing save.
- **Confirmed public-launch blocker: admin mutation handler remains unauthenticated.** The `admin` WebSocket handler has no `requireCharacter`, operator allowlist, or permission check. It directly grants gold/crystals/gems/XP, sets level, stats, inventory, profession, and resets character state. Its source comment explicitly says it is intentionally open for the Stage 28 test build. The earlier top-level comment about operator allowlisting is not wired into this handler. This must be disabled or protected server-side before any public deployment; hiding the UI is not authorization.
- Session tokens are 32 random bytes, stored as SHA-256 digests, expire after 30 days, and are checked against account ownership at WebSocket join. Passwords use per-account random salts with scrypt and constant-time hash comparison. No password-hash or token-entropy defect found in this source pass.
- Auth rate limiting is process-local, 10 requests per 15 minutes per `req.socket.remoteAddress`. It is not shared across multiple server processes and does not account for trusted reverse-proxy client IP headers. Treat multi-instance/proxy deployment as an operational hardening requirement; do not trust forwarded headers until proxy trust is explicitly configured.
- Guest IDs use browser-generated UUID/random bytes. The server validates syntax but does not mint or bind the ID to a proof on first guest creation. This reinforces the guest ownership issue above.
- `/auth/check` verifies a token but is not itself rate-limited; it does not mint sessions or mutate player state. CORS is wildcard, but auth uses bearer tokens in JSON bodies rather than cookies; deployment still must serve the client and auth endpoint over HTTPS.
- Public player codes are deterministic SHA-256-derived 24-character identifiers. Resolution compares against saved and online player IDs; this does not expose the underlying raw ID in the social UI, but the code is a stable public identifier and should not be treated as an authentication secret.

No tests executed. No gameplay code changed.


### Account / character persistence and restart audit — 2026-11-09

Reviewed `server/src/playerSaves.ts`, `server/src/playerJson.ts`, `server/src/jsonPersistence.ts`, account/session handling and room lifecycle in `server/src/index.ts`, plus `playerSaves.test.ts`, `jsonPersistence.test.ts`, `duplicateSessionRuntime.test.ts`, `authAccountRuntime.test.ts`, `authLogoutRuntime.test.ts`, and `groupTravelPersistenceRuntime.test.ts`. Source-level review only; tests were inspected but not executed.

- Player snapshots are synchronously serialized to a unique sibling temporary file and atomically renamed over `players.json`. Before replacement, the previous file is copied to a backup; only the newest five backups are retained. Failed backup creation cancels the save. This protects against partial/truncated writes, but is not a substitute for fsync or a transactional database under sudden power loss.
- The room save path reloads the latest complete player map, replaces only the current character's entry with its live snapshot, and writes the complete map. Multi-player persistence similarly merges the specified online player snapshots into the latest loaded map. In the current single Node process, these filesystem operations are synchronous and each callback runs to completion, so two ordinary in-process save callbacks do not interleave midway through their read-modify-write sequence. No single-process lost-update race was confirmed in these paths.
- **Deployment boundary:** online-player ownership, duplicate-session protection, rate limiting, groups, and invitations are held in process-local maps. The JSON stores also have no cross-process lock or transaction around read-modify-write. Running multiple server processes/instances against the same data directory is therefore not safe: two instances could each admit the same character or overwrite a snapshot written by the other. Current architecture should be treated as single-instance until shared coordination/storage is introduced. This is a deployment/scale constraint, not a defect for the current one-server test setup.
- Account and session files are independently written through temporary files and atomic rename. Session tokens are persisted as digests; expired sessions are filtered when a new session is issued. Account registration writes the account before removing old guest sessions, but session verification cross-checks the account record: a stale guest session for a now-linked player is rejected even if a crash leaves its record in `sessions.json`. The inspected runtime test explicitly simulates this stale-session condition. No account-linking stale-token bypass was found in the reviewed flow.
- The inspected duplicate-session runtime test creates two valid guest tokens for one character, verifies that the second live room is rejected, then confirms the first room can still mutate and save the character. It is test coverage present in source; it has not been executed during this audit.
- Normal room leave removes the player from online maps, clears an active expedition search/travel state, and saves. Room disposal also saves. This can cause a second backup/save during teardown, which is backup churn rather than confirmed data loss.
- On reconnect after an ungraceful process restart, an expedition with a non-empty group ID is reset if its in-memory group no longer exists. A solo expedition has no group ID and is not reset by this branch; its persisted searching/moving state and end timestamp can survive restart. This is asymmetric behavior; confirm whether solo actions are intended to continue across a server restart while orphaned group actions are cancelled. No exploit or data-loss issue is established by this behavior alone.
- The save layer is synchronous and performs a full read/serialize/write plus backup on each save. This is simple and predictable for the current small single-player test environment, but will add blocking I/O as the player file grows. No performance benchmark was run.
- The current tests cover save validation, backups, duplicate sessions, account linking, logout revocation, and grouped travel persistence. They do not constitute an executed test result in this audit. No tests were run and no gameplay code was changed.

#### Follow-up decisions / tests
1. Keep deployment single-instance while using JSON persistence; before horizontal scaling, migrate to a transactional shared database and shared session/online-player coordination.
2. Decide whether solo expedition timers should continue through an ungraceful server restart, and make the policy explicit for both solo and group actions.
3. Add a runtime restart test that starts a character, performs a persisted mutation, terminates the server, restarts against the same data directory, reconnects with the same valid session, and verifies character state and session validity. Include a separate abrupt-termination case between mutation and save to document the known durability window.
4. Run the existing persistence/auth/group runtime tests and full server suite after the source audit and implementation plan are approved.

#### Scope note: private test build
The unauthenticated admin command handler is intentionally retained for the user's current private testing setup and is not treated as an active blocker for this private single-tester phase. It remains a pre-public-deployment checklist item; no admin-handler code was changed.


### Gameplay reward claims and repeatable resource actions — 2026-11-09

Reviewed the hunt reward pipeline (`hunt`), mining, daily/fountain rewards, race-daily claims, story/faction quest claims, achievements, return rewards, tavern wagers, crafting claims, chest opening, and relevant runtime tests. Source-level review only; no tests executed and no gameplay code changed.

- **Mining cooldown is currently a 1-second test setting, not a production economy rule.** The user confirmed the intended live cooldown: 30 minutes for all characters and 15 minutes for characters with the Miner profession. The current 1-second interval is intentionally used for testing; it is not an exploit or a live-balance defect. The production timer change remains pending and has not been implemented.
- Daily login reward uses a UTC date key and refuses a second claim on the same UTC day; consecutive streak increments only when the stored date is yesterday, otherwise resets to one. Existing runtime test covers consecutive day, missed day, reward amounts and same-day duplicate rejection.
- Fountain uses a UTC date check and records its claim timestamp before issuing one of three rewards. No duplicate same-day claim path was found in the synchronous single-process handler.
- Race-daily claims verify race-specific quest ID, level, progress, and a per-day claimed list before issuing gold, XP and reputation. Progress is advanced by mine/hunt events and reset by the shared `raceDailyState` helper. A dedicated runtime test for race-daily rollover, claim, duplicate rejection, and reconnect persistence is not present in the reviewed test set; add one before relying on it in production.
- Story, faction-story, faction-max-rank, daily/weekly challenge, and achievement claims set their completion marker before returning the reward through the same synchronous handler. Repeated requests in one process are rejected by the marker. Existing quest runtime coverage does not fully exercise faction story chapter III event progress, all race-daily paths, or every achievement threshold.
- **Previously confirmed weekly rollover bug remains:** weekly claim still checks stored `challengeWeek` / `weeklyHunts` without rolling them to the current ISO week at claim time. The user has already accepted this as an error. Required fix/test remains in the earlier journal entry; no code change made.
- Hunt cooldown is also 1 second and there is no daily hunt cap. Each successful fight advances daily/weekly challenge progress and pays zone rewards; losses still consume the cooldown and battle count but no gold/XP/loot. This is a high-frequency repeatable core loop and should be reviewed together with zone reward scaling and the mining faucet during economy balancing. No reward duplication from a single synchronous handler invocation was established.
- Craft claims remove the completed job from the queue through `claimCraftJob`; unique-amulet conflicts refund the recorded recipe materials. Chests consume one indexed chest and validate optional expected count before rolling. No duplicate-claim exploit was proven in the inspected paths.

#### Follow-up tests / decisions
1. Add runtime tests for race-daily day rollover, successful claim, duplicate rejection, and reconnect persistence.
2. Add a weekly challenge test where 15 hunts are recorded in the prior ISO week, the ISO week changes, and the claim is attempted before any new-week hunt; assert no old-week reward is granted and current-week progress is zero.
3. Implement and test the confirmed mining cooldowns before public gameplay: 30 minutes generally and 15 minutes for the Miner profession. Keep the 1-second interval confined to the test configuration.
4. Continue reviewing auction, crafting, clan, dungeon, PvP, and reward handlers for request replay, ownership validation, and persistent currency/inventory consistency. Existing findings about these systems remain in their earlier sections.


### Ring terminology and mining timer clarification — 2026-11-09

- Player-facing terminology for the equipment slot/category is now «Кольцо» / «Кольца». Item names and player-facing messages using the previous jewelry terminology have been updated.
- Internal compatibility identifiers remain unchanged intentionally: `kind: 'amulet'`, `equipment.amulet`, `collections.pendantLevels`, `upgradePendant`, PEN item IDs, and existing asset filenames. These are persisted or referenced by existing saves and client/server messages; changing them requires a separate migration and is outside this display-terminology change.
- Mining timer requirement confirmed by the user: current 1-second cooldown is test-only; target live cooldown is 30 minutes for all characters and 15 minutes for the Miner profession. Timer implementation is deferred; no mining gameplay code changed in this commit.

### Persistence lifecycle edge cases — 2026-11-10

Continued the persistence audit from the current branch head. Rechecked the exact room lifecycle (onJoin, onLeave, onDispose, private save), health-regeneration interval, synchronous save helpers, auth/session JSON writes, and the end of server startup/shutdown wiring. Source-level review only; no runtime tests executed and no gameplay code changed.

- **Confirmed unsaved-on-join window:** onJoin updates lastSeenAt, applies offline health regeneration, normalizes legacy city/equipment fields, initializes expedition state, and may set returnBonusAvailable; it sends the initial notice directly with client.send, rather than using this.notice (which saves). Therefore these join-time changes are not guaranteed to reach players.json until the character performs an action that calls the save path or the room later leaves/disposes. If the process terminates first, the in-memory join updates are lost. Most gameplay mutations reviewed call this.notice or persistPlayers, so this finding is specifically about join-time normalization/regen/return-bonus state and other changes made before the first persisted action.
- **Confirmed regeneration durability window:** the one-second room interval calls applyHealthRegeneration on the live player, but does not itself persist the player. Regenerated health/regen timestamps are saved on a later save-triggering action or room leave/disposal. An abrupt process termination can therefore lose regeneration accumulated since the last save. This is a durability/expected-behavior decision, not evidence of currency or item loss.
- The server startup tail registers the HTTP/WebSocket server and calls gameServer.listen; no explicit SIGINT/SIGTERM shutdown handler or shutdown routine was found in the reviewed file. Room leave/disposal saves exist, but the source does not establish that an operating-system termination signal will drain rooms and invoke those callbacks before process exit. Treat graceful shutdown persistence as unverified until a controlled shutdown test is added.
- The player save operation is synchronous and atomic at the rename boundary, but neither it nor the generic account/session JSON writer calls fsync on the file or containing directory. Atomic rename protects against partial replacement; it does not guarantee survival of sudden power loss or storage-cache loss.
- The single-process read/modify/write path remains serialized by synchronous Node callbacks. No in-process concurrent-write race was confirmed. Cross-process shared-directory operation remains unsupported as documented in the previous persistence section.

#### Follow-up tests / decisions
1. Add a runtime test that connects a character and disconnects before any gameplay action; assert join-time changes are persisted on normal leave.
2. Add a health-regeneration test that compares a save before and after normal leave, and documents the expected loss window under abrupt termination.
3. Add a controlled SIGTERM/SIGINT test: mutate a character, request server shutdown, restart using the same data directory, and verify player data and session behavior. Decide whether shutdown should stop accepting connections, close rooms, and await saves.
4. Decide whether regeneration must be durable continuously or whether saving on action/leave is sufficient for this single-instance game. If continuous durability is required, use a bounded autosave interval or a transactional persistence layer rather than writing the full player file every second.

No code changed; this is an audit/documentation update only.
### Restart coverage and auth-test source defect — 2026-11-10

Reviewed the current auth/account runtime tests and test command for server restart coverage. Source inspection only; tests were not executed.

- **Confirmed test-source blocker:** server/test/authAccountRuntime.test.ts declares `const secondGuest` twice in the same `try` block: first as the parsed guest-session response, then again for the unrelated unlinked guest response near the end of the test. This is a duplicate lexical declaration and prevents the test module from parsing. Since this file is explicitly included in the `server` npm test script, the full server test command is expected to fail when it reaches this module unless the second variable is renamed. This has not been verified by executing the test command; the source-level syntax conflict is definitive.
- Existing runtime helpers start a child server and stop it by sending SIGTERM, with SIGKILL fallback after five seconds. The production server source has no explicit SIGTERM/SIGINT handler, so the helper's termination path does not establish graceful room disposal or persistence.
- The reviewed runtime tests exercise duplicate live-session rejection, account linking and stale guest-token rejection, logout revocation, and group travel persistence. They do not restart the same server against the same data directory and then reconnect using a previously issued valid session token.
- Session records are persisted to sessions.json and verification reads them from disk on each auth check. The code structure suggests valid tokens should survive a normal process restart while unexpired, but this behavior remains unverified end-to-end because there is no restart/reconnect runtime test.

#### Required follow-up
1. Rename the second `secondGuest` local in authAccountRuntime.test.ts (for example, `unlinkedGuestResponse`) and rerun the auth test plus full server suite.
2. Add a two-process restart test using the same temporary data directory: create guest session, connect and mutate character, stop server, start a fresh server on a new free port, verify the original token via /auth/check, reconnect through WebSocket, and assert the saved character state.
3. Add a separate abrupt-stop case that documents which unsaved in-memory changes are expected to be lost; do not conflate it with a graceful-shutdown guarantee.

No code changed; this entry records an audit finding only.
### Ring terminology follow-up — 2026-11-10

A further source scan found two grammatical leftovers in player-facing strings after the approved pendant-to-ring terminology change: «Старое кольцо наконец-то вспомнил» and «Такой кольцо». Corrected them to «Старое кольцо наконец-то вспомнило» and «Такое кольцо». This is a terminology/grammar-only correction within the user's explicit request; no gameplay behavior or persisted identifiers changed.

During the same scan, timer state was reviewed: craft finishAt, lastMineAt, buffUntil, guild-skill cooldown timestamps, PvP timestamps/immunity, and solo expedition endsAt are persisted as player data and use wall-clock timestamps. They therefore continue to elapse while a character is offline. Group expedition actions are cleared on reconnect when their in-memory group no longer exists; solo expedition actions are not cleared by that branch. Whether solo actions should resume after restart remains a design decision, not a confirmed defect.

No tests executed.

### Client-server action acknowledgement and reconnect audit — 2026-11-10

Reviewed client/src/main.ts action dispatch, connection lifecycle, pending-action handling, and the corresponding server message handlers in server/src/index.ts. Source inspection only; no runtime tests or network-failure simulations were executed.

- **Confirmed client-side duplicate-action window:** guarded actions are blocked only by an in-memory Set keyed by action name. Each click schedules an unconditional 8-second timeout that removes the action from the Set and re-enables the clicked element, regardless of whether the server has acknowledged or completed the operation. A slow response can therefore leave the operation in progress after the client permits another submission.
- **Confirmed acknowledgement correlation gap:** the client clears the entire pendingActions Set on every incoming `notice` message. The notice has no action identifier or request ID, and the server uses the same notice channel for both success and validation/error responses. Consequently, an unrelated notice can unlock all pending actions, not just the action that caused that notice. A notice sent to an online PvP victim is one concrete cross-action example: the target client receives a notice about being attacked, and its client handler clears every pending action.
- **Confirmed no application-level idempotency key in the reviewed action protocol:** client send(type,data) forwards only the action type and payload; guarded action requests do not carry a unique request ID. The reviewed server handlers do not deduplicate repeated request IDs. The WebSocket transport may preserve delivery ordering, but it cannot distinguish an intentional second action from an application retry or a second click after the client timeout.
- This creates a **confirmed duplicate-execution risk at the application protocol/UI level**, not proof of a transport-level duplicate packet. For example, repeated valid `buyItem` messages each independently deduct the price and append another item; repeated `dungeonRun` messages each consume another available daily attempt and resolve another battle; repeated `tavernGame` messages each charge another stake. These operations are not inherently idempotent. Server-side checks still constrain them (funds, inventory, remaining attempts, cooldowns, etc.), so the issue is accidental/retry duplication rather than an established free-reward exploit.
- Some server operations already have state-based duplicate protection: one-time daily/quest claims check their claim markers; chest opening validates the inventory slot and expected chest count; craft claim removes a specific job; auction purchase/cancel uses transactional lot state. These protections reduce the impact for those paths but do not replace a request-level acknowledgement protocol.
- **Reconnect behavior:** on room leave, the client marks itself disconnected, clears pendingActions, renders, and schedules a reconnect after five seconds. It retains the auth token and attempts to join again. If join fails, it calls /auth/check; a 401 clears the token and returns to login, while transient failures retain the token and schedule another retry. On successful join, it reads the current server player state and requests catalogs and the major list/state messages again. This is a reasonable state-rehydration pattern; no automatic replay of the interrupted action was found.
- Because interrupted requests are not replayed, the main ambiguity is the familiar commit/acknowledgement gap: the server may have committed and saved an action before the connection drops, while the client never receives its notice. After reconnect, the authoritative player state should be reloaded, but the UI does not retain a request record that can tell the player whether the original operation committed. Manually repeating a non-idempotent action can then perform it a second time if its server preconditions still allow it.
- The guarded-action list also omits several state-changing controls, including `upgradePendant`, `upgradeSetMastery`, and the four expedition start/claim actions. Their server-side state and resource checks limit some repeats, and no separate exploit was established from this omission; however, the client does not provide the same pending-click protection for them.
- The generic `send` helper checks whether a room object exists, but not the explicit `connected` flag. A stale/closed room reference may therefore be used by a click occurring during the reconnect interval; exact behavior should be verified in a browser-level disconnect test rather than inferred from source alone.

#### Required follow-up / recommended protocol hardening

1. Replace the unconditional 8-second unlock with per-request state that is resolved by a matching server response; timeout should mark the result as unknown and trigger a state refresh, not silently declare completion.
2. Add a unique request ID to mutating client messages and a server-side deduplication/result cache scoped to player + request ID. Persist deduplication state alongside the transaction for high-value operations where crash/retry safety is required.
3. Return structured action acknowledgements containing request ID, action type, success/failure, and authoritative updated state (or a state revision). Do not clear unrelated pending actions on a generic notice.
4. Keep authoritative state rehydration on reconnect and display an explicit “checking result” state for an action interrupted by disconnect. Do not automatically replay non-idempotent actions until idempotency is implemented.
5. Add runtime tests for duplicate buyItem, dungeonRun, tavernGame, openChest, craftClaim, and auctionBuy requests; test that one request ID can commit at most once, while a distinct request ID represents a new intentional action.
6. Add browser/E2E tests that disconnect after server commit but before response delivery, reconnect with the same token, verify authoritative state, and ensure retrying the same request cannot double-charge or double-grant.
7. Guard all mutating controls consistently and make `send` refuse to submit while `connected` is false or the room is not in a joined state.

No gameplay code changed; this entry records source-level findings and the required reliability work. No tests were executed.


### Client/server state synchronization and stale-view audit — 2026-11-10

Reviewed the Colyseus Player schema, room state lifecycle, client state/message handlers, and PvP offer lifecycle. Source inspection only; no browser session or live multiplayer test was executed.

- The authoritative player object is synchronized as `RoomState.player`. Player fields that contain collections (inventory, equipment, quests, crafting queue, etc.) are JSON-encoded strings; server mutations generally replace the whole string property. The client assigns `player = room.state.player` on initial join and on every `room.onStateChange`, then rerenders. This provides a single authoritative snapshot path for player-owned state.
- Separate messages carry non-player or transient views: catalog, expedition state, hunt-group state, PvP offers, auction listings/history, clan data, combat reports, and crafting-queue refreshes. These are stored in independent client variables. They are not automatically versioned against the player snapshot; the client relies on server messages and explicit refresh requests to keep them current.
- The client handles a `craftQueue` message by assigning `player.craftQueue = JSON.stringify(d.jobs || [])` locally and rerendering. This is a client-side cache write into the Colyseus state object, not a server mutation or durable save. The server's `craftQueue` request currently returns the queue without changing it (`finishCraftJobs` is a no-op because completed jobs remain claimable based on finishAt). This is redundant with the authoritative Player.craftQueue field and creates two update paths for the same data; it should be removed or kept as a separate local queue variable to avoid confusion about authority.
- On successful reconnect, the client reloads `room.state.player` and explicitly requests catalog, expedition state, group list, clan list/quests/territories, PvP list, auction lists/history, dungeon list, clan-war list, and craft queue. This is broad rehydration and reduces stale-cache risk after reconnect. The client does not automatically refresh these independent views on a periodic basis while continuously connected; several screens expose manual refresh controls.
- **Confirmed stale PvP offer view and expiry mismatch:** the server sends `offersExpireAt` with `pvpList`, and `pvpList` creates a new offer set when the cooldown has ended and the previous offer timestamp has expired. The client stores `offersExpireAt` but never reads it when rendering the opponent list or updating the one-second PvP timer. It therefore continues to show the previous four opponents and the text “Можно выбрать одного из четырёх соперников” after the offer expiry until the user manually refreshes or reconnects.
- **Confirmed server-side expiry enforcement gap:** `pvpChallenge` verifies that the requested character is in the persisted `offeredIds`, checks the attack cooldown, level difference, and target immunity, but does not compare `offersExpireAt` with the current time. Thus an expired offer remains challengeable if no fresh `pvpList` request has replaced the stored IDs. This contradicts the 15-minute offer lifetime represented by `offersExpireAt` and the client copy that says the list is fixed for 15 minutes. Add a server check that rejects expired offers and requires a fresh list.
- PvP list rendering also retains the ±2 level restriction in both the server's offer filtering and challenge validation, already recorded as conflicting with the user's approved requirement that all registered characters be eligible. This is a separate gameplay change to implement after audit, not a new finding.
- Expedition UI prefers the separately cached `expeditionState` over `player.quests.expedition` when rendering. The server sends a fresh `expeditionState` on join and on the reviewed start/travel transitions; reconnect also explicitly requests it. No confirmed stale expedition state path was established in the inspected lifecycle. Continue checking every reset/leave/claim path before changing this precedence.
- Auction and clan views are separate snapshots and can become stale while the player remains connected if another player changes shared data. The UI provides explicit refresh actions; no automatic push/broadcast consistency guarantee is present in the reviewed handlers. Whether live updates are required is a product decision, not a correctness defect by itself.
- Player state schema is below Colyseus's 64-field limit (the schema comment says legacy coordinates are intentionally ordinary properties). No schema-field overflow issue was found in the reviewed declaration.

#### Required follow-up / recommended corrections

1. Enforce PvP offer expiry inside `pvpChallenge`, not only when a new `pvpList` request arrives; return a clear expired-offer response and refresh the list.
2. Use `offersExpireAt` in the client countdown/status. Once expired, disable stale opponent buttons and prompt the player to refresh.
3. Remove the client-side write to `room.state.player.craftQueue`; use the authoritative state field or a dedicated local queue cache with an explicit source.
4. Decide whether auction/clan shared data should be live-pushed to online clients or remain explicitly refreshed. If live updates are required, add broadcasts and tests for two clients observing a completed transaction.
5. Add browser tests for PvP list expiry (including waiting beyond 15 minutes without clicking refresh), reconnect rehydration of player + side-channel state, and queue consistency after craft start/claim.

No gameplay code changed; this entry records source-level findings and follow-up work. No tests were executed.
