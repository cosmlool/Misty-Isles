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
