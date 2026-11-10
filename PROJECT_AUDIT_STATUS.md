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
- **Legacy-only subclass compatibility code, not an active mismatch:** shop purchase contains an activeSubclass/subclassProfession fallback, while equipItem checks base profession only. Current PlayerSchema declares neither field and no current handler sets them, so this mismatch is not reachable in the present gameplay. Do not change equip validation unless a subclass system is implemented.
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
- `clanSeasonBoard()` returns only the top 10; clans outside that list resolve to rank 0 in `clanSeasonReward`. The reward ternary currently treats rank 0 as `<= 3`, so they receive 2,500 gold. See the confirmed finding below.
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


### PvP cooldown and opponent rotation implementation — 2026-11-10

The user explicitly confirmed the intended arena behavior: after each real PvP battle, the attacker waits 15 minutes (the current one-second test timing is not the desired live rule); when the timer ends, the arena must offer different opponents. This is an approved gameplay change and was implemented on the audit branch.

Changes made:
- Kept the canonical `PVP_ATTACK_COOLDOWN_MS = 15 * 60 * 1000` and verified the server derives cooldown from persisted `lastPvpAt`.
- Server now returns an empty opponent list while the attack cooldown is active.
- On a new offer generation, matchmaking first excludes the four IDs from the previous offer set. If at least four other eligible registered characters exist, all four new offers are different. If fewer than four alternatives exist, it fills remaining slots from the eligible pool so the arena can still show up to four.
- Removed the ±2 level restriction from both matchmaking and challenge validation, matching the user's earlier requirement that all registered characters may appear. Characters still need a valid created profile and must not currently have PvP immunity.
- After a battle, the server stores the previous offered IDs before clearing the active list.
- The server now rejects a challenge when its offer timestamp has expired, even if the requested ID remains in an old persisted list.
- Client automatically requests a fresh list when the 15-minute cooldown/offer expiry ends; it no longer requires the player to manually press refresh. Expired opponent cards are cleared while the refresh is requested.
- Updated PvP screen copy to describe unrestricted level matchmaking.

Tests updated (not yet executed):
- `pvpOperations.test.ts`: 15-minute cooldown, unrestricted level matching, protected/invalid profile exclusion, and selecting four new opponents when enough alternatives exist.
- `pvpRuntime.test.ts`: integration scenario uses nine saved targets across widely different levels, verifies four offers, a 20% gold transfer, persisted cooldown and victim immunity, then restarts the isolated test server with the same session after advancing only the fixture timestamp and verifies that the next four offers do not repeat the previous set.
- No test execution, build, or browser run has been performed in this environment. The user's Windows test environment should run the focused PvP tests and then the full server suite.

Implementation commits:
- `2b775164d60d680a60c42e57cdb898dbd3957404` — opponent selection logic
- `3e2010aedd37c9554db95da57505d4c5bdced9f9` — server offer expiry/rotation
- `3cb32238b8f633ce2ee082a22d6eec26d4cab6a4` — client automatic refresh
- `bd5dd5cea81f593d661b761bb54ba507714fb181` — PvP operation tests
- `55e363d79b6e04d25f024050fc783738121219fa` and `9288d0db1882efb28906c7a1385b79712941f799` — PvP runtime test
- `aed23b1d7aa15aee87fc49b942ffc416dc10ce16` — UI copy


### Multi-player auction and clan synchronization audit — 2026-11-10

Reviewed auction transaction snapshots, auction handlers, online-player state, clan transaction commits, and clan broadcasts. Source inspection only; no two-client runtime test was executed.

- **Confirmed persistence snapshot consistency gap in auction transactions:** `auctionSell`, `auctionCancel`, and `auctionBuy` build a complete players snapshot from `loadPlayers()`, then merge only the current player and (for a buy) the online seller. Unlike `commitClanState`, these handlers do not merge every entry in `ONLINE_PLAYERS` before calling `auctionTransactions.commit`. The transaction store atomically replaces the entire `players.json` with that snapshot. Any other connected character whose in-memory state is newer than its last persisted save can therefore have that newer state overwritten on disk by an older snapshot. The live Schema object is not immediately replaced, so this is a persistence regression/lost-update window rather than an immediate visible rollback; a crash before that player's next save/leave can make the stale disk copy authoritative after restart. Recommended fix after audit: merge every online Player.toJSON() into the auction snapshot before every auction transaction commit, then apply the committed snapshot only to the transaction participants (or consistently reconcile all online players).
- Auction list changes are sent only to the player who performed the action. An online seller does receive the updated Player Schema after a purchase, but their cached auction list is not refreshed; other online clients also retain stale lot lists until manual refresh/reconnect. Server-side transaction validation still rejects a purchase of a lot that has already sold, so this is a stale-view UX issue, not a confirmed double-sale.
- Auction history is fetched per-player and is not pushed to other clients; this is expected for personal history.
- Clan transactions use a safer persistence pattern: `commitClanState` merges all online players into the full players snapshot before writing the clan transaction journal. Clan overview, quests, territories, and active wars are broadcast to online clan members after the corresponding mutations. No equivalent all-online-player snapshot omission was found in the reviewed clan commit helper.
- **Confirmed clan-leave side-channel stale view:** when a player leaves a clan that still has other members, the server sends the leaver an updated `clanList`, but does not send an empty `clanQuests` payload or refreshed `clanWarList` to that leaver. Their client can continue displaying the former clan's quest/upgrades and war list until a manual refresh or reconnect. Server checks still reject clan actions because the authoritative player no longer has a clan; this is a stale UI cache, not an authorization bypass.
- Clan join/create and the major clan mutation paths broadcast overview and quest data to current members. Territory capture broadcasts territory changes to all current clan members; the list request itself remains available to any client.
- PvP state changes for an online victim are applied to the victim's live Player Schema and persisted with the attacker's transaction save; the victim also receives a notice. The attacker's cooldown and offer state are persisted in the attacker's player save.

#### Follow-up

1. Merge all online player snapshots into auction transaction inputs before committing, and add a runtime test where a third online character has unsaved in-memory state while another player lists, buys, or cancels a lot; assert that the third player's newest state survives in `players.json`.
2. Push updated auction listings to all connected clients (or explicitly label the view as refresh-based and refresh it on tab entry); test two buyers attempting the same lot and both clients receiving the final list.
3. On clan leave, send the departing client empty `clanQuests` and the current `clanWarList` (and any other clan-scoped side-channel state), then add a two-client leave test.
4. Test online PvP victim Schema, saved gold, losses/wins, immunity and reconnect state against the same transaction result.

No gameplay code changed during this audit step. No tests were executed.


#### PvP timing clarification from source verification

The current audit-branch source already defines real-player PvP cooldown as 15 minutes (`PVP_ATTACK_COOLDOWN_MS = 15 * 60 * 1000`), and the PvP runtime test previously asserted that constant. The one-second cooldown found elsewhere is `CLAN_WAR_ATTACK_COOLDOWN_MS = 1_000`, used for a player's next attack in a clan war; it is a separate mechanic and has not been changed. The PvP fix therefore closes the missing offer-expiry enforcement, adds automatic list refresh and opponent rotation, and preserves the existing 15-minute real-player cooldown rather than changing a one-second PvP constant.

A legacy direct `pvpChallenge` path still accepts four known bot IDs and bypasses real-player cooldown/offer checks; these bots are not returned in the arena list and award no PvP rewards. Whether these training-only direct challenges should also trigger the 15-minute cooldown remains a gameplay-policy decision; no change was made to this legacy path.


#### Additional PvP roster consistency edge case

- **Confirmed conditional underfilled-list case:** while an offer set is still within its 15-minute validity window, `pvpList` does not regenerate it if one or more offered characters become protected by another attack. The response filters protected targets out of the displayed list, but retains the original `offeredIds` and expiry. The attacker can therefore see fewer than four opponents until the offer set expires, even when other eligible registered characters exist. Server challenge validation correctly rejects a now-protected target. Recommended follow-up: refresh/refill the current offer set when its currently eligible count falls below four, preserving still-valid offers where possible and selecting replacements without repeating the previous batch.


### General online-player snapshot overwrite risk — expanded finding

A deeper check of `playerSaves.ts` and `GameRoom.save()` shows that the issue recorded for auction transactions is not limited to the auction.

- `savePlayers(all)` writes the supplied complete players object as the new `players.json`; it does not merge online state itself.
- `GameRoom.save()` loads the persisted file, replaces only the current room's player entry with `this.state.player.toJSON()`, then writes the complete object. It does not merge the other entries in `ONLINE_PLAYERS`.
- The shared `persistPlayers(players)` helper similarly loads disk state and replaces only the supplied participant entries. It is used by grouped dungeon and expedition flows, and `persistPlayer(other)` is used by friend acceptance.
- Therefore, a save initiated by one character can replace a different online character's newer in-memory state with that character's older persisted copy. The clearest recurring unsaved field is health regeneration, which mutates live player state once per second without an immediate save; join-time normalization and other state changes between save triggers can also be affected. If the affected character later saves normally, the current live state may be written back, but a process crash before that save can make the regressed disk snapshot authoritative after restart.
- This is a **confirmed cross-player persistence consistency defect** from source structure. It is not proof that every action loses another player's currency or inventory: most mutating actions save the acting player immediately, and many group/transaction flows persist their explicit participants. The missing invariant is that a whole-file save must not silently omit newer live state belonging to unrelated online players.
- Clan transaction commits are an exception: `commitClanState` explicitly merges every `ONLINE_PLAYERS` entry before writing its multi-file snapshot.

Recommended fix after the audit: introduce a single, carefully ordered player-snapshot coordinator. Ordinary saves should merge all online player snapshots before writing. Multi-player transaction commits must first apply their transaction result to the participating live Player objects (or preserve the committed participant records separately), then merge unrelated online players, so the merge cannot overwrite the transaction's own debits/credits with pre-transaction in-memory values. Add a three-client test: client A has unsaved in-memory state, client B performs a normal save, and client C triggers a group/auction transaction; assert all three latest states survive and restart restores them.


The same full-snapshot omission also exists in the real-player `pvpChallenge` save path: it starts from `loadPlayers()` and replaces only the attacker and target records before `savePlayers(all)`, without merging unrelated online players. By contrast, `pvpList` explicitly merges all entries from `ONLINE_PLAYERS` before its save. The recommended snapshot coordinator must cover `GameRoom.save`, `persistPlayers`, auction transactions, and PvP challenge commits; fixing only auction handlers would leave the underlying cross-player persistence defect active.


#### Multi-client test coverage gap

- The reviewed auction unit tests prove that a second sequential purchase fails after the lot has been removed, and the transaction-store tests prove journal recovery after a simulated process crash. They do not create two live buyer clients and race two `auctionBuy` messages against the same lot.
- The server's current auction message handlers are synchronous and contain no `await`, so Node processes each handler callback to completion before the next callback; this reduces the risk of an in-process interleaving race. Still, a two-client runtime test is needed to verify the real Colyseus path: exactly one buyer succeeds, the other receives “lot is no longer available”, one item is delivered, one payment is charged, and both clients eventually see the same listing state.
- The reviewed PvP runtime test uses one online attacker and offline saved targets. A two-online-player PvP test is still needed to verify the victim's live Schema, result notification, persisted gold/stat changes, immunity, and reconnect hydration.


### Complete player-save write-path inventory — 2026-11-10

Re-scanned every production server source file in the current branch for direct player-file writes, savePlayers, and the shared persistence helpers. This is source inspection only; no tests or live multi-client session were run.

The production write paths to players.json are:

1. **Ordinary room save — GameRoom.save()** (server/src/index.ts): reads the disk snapshot, replaces only the current room's player, then calls savePlayers. Invoked by notice(), onLeave(), and onDispose(). It does not merge other entries from ONLINE_PLAYERS.
2. **Shared participant helper — persistPlayers() / persistPlayer()** (server/src/index.ts): reads disk and replaces only the explicitly supplied player entries. Call sites include group dungeon success/failure, expedition search start/claim and travel start/claim, and friend acceptance. It does not merge unrelated online players. The helper is therefore another instance of the same full-snapshot omission, not an independent safe writer.
3. **PvP list generation** (pvpList): merges every current ONLINE_PLAYERS entry and the current player into the disk snapshot before saving. This path already follows the all-online merge pattern.
4. **PvP battle** (pvpChallenge): starts from disk, replaces the attacker and target only, then calls savePlayers. It does not merge unrelated online players.
5. **Auction transactions** (auctionSell, auctionCancel, auctionBuy): build full snapshots from disk plus the seller/buyer and, for a buy, the online seller; then auctionTransactions.commit replaces the complete players.json. They do not merge every online player. This is the previously recorded auction lost-update window.
6. **Clan and clan-war transactions** (commitClanState): merges every ONLINE_PLAYERS entry into the disk snapshot before clanTransactions.commit. This is the currently consistent all-online snapshot pattern.
7. **Transaction recovery**: auction and clan transaction stores can replay a previously journaled full players.json snapshot at startup or before a later transaction. These are additional whole-file replacement paths, but they replay the exact transaction snapshot rather than reading live online state.

No other production writer of players.json was found in the scanned server/src tree. playerSaves.savePlayers itself is a low-level whole-file writer; it does not merge online players. Auction/clan transaction stores also write the configured players file directly through their own atomic-write helper and therefore bypass the ordinary player-save backup rotation.

**Additional confirmed journal-coordination risk:** if an auction or clan transaction fails while applying its target files and its immediate recovery attempt also fails, the transaction code retains the journal and throws. The message handler then catches the error and calls this.notice(), which invokes ordinary GameRoom.save(); other ordinary saves and pvpList can also continue while the journal remains. Those writers do not first recover or block on the pending journal. A later transaction or server restart replays the older retained full snapshot, which can overwrite player changes successfully saved after the failed transaction. This is a conditional failure-path data-loss risk, not evidence that normal successful transactions lose data. The centralized persistence layer must treat a pending journal as a write barrier: recover it successfully before accepting any unrelated whole-file player write, or fail closed until recovery succeeds.

#### Centralized correction requirements

- One player-snapshot coordinator must merge live online state and persisted offline state without allowing stale online snapshots to overwrite transaction participants' committed results.
- Every path above must route through the coordinator, including ordinary saves, group/expedition helpers, PvP, auction, clan commits, and journal recovery.
- Transaction participants must be reconciled to their committed result before the all-online merge, or their committed records must be explicitly protected during the merge.
- Pending transaction journals must block unrelated player-file writes until replay succeeds.
- Preserve the existing backup policy for ordinary saves and explicitly decide whether transaction commits also need backup snapshots.
- Add tests for: unsaved third online player during ordinary save; same during group/expedition save; same during auction sell/cancel/buy; PvP challenge with a third online player; clan transaction; and failed transaction + failed recovery followed by attempted ordinary save and subsequent recovery/restart.

No gameplay code was changed in this audit step. No tests were executed.


### Follow-up audit — cross-journal recovery ordering and craft job identity — 2026-11-10

Source review of transaction-store startup order, failure handling, craft operations, and the current craft unit tests. No tests were executed.

- **Confirmed cross-journal recovery ordering risk:** startup runs auction journal recovery first and clan journal recovery second. Each journal contains a complete players.json snapshot. If a clan transaction journal remains pending after both its commit and immediate recovery fail, the process can still accept an auction transaction because the auction store checks only its own journal. The auction transaction can then successfully write a newer players snapshot. On restart, startup replays the pending clan journal after the auction journal and replaces players.json with the older clan snapshot, potentially reverting the later auction player changes. The inverse ordering is also possible when an auction journal is pending and a later clan transaction is allowed to proceed; whichever pending journal is replayed last can overwrite the other transaction's player snapshot. This requires a storage failure/recovery failure path, but the current independent stores have no shared write barrier or global transaction coordinator. Treat both journals as one persistence domain and block all player-file writers/other transaction commits while either journal is pending.
- The startup recovery calls happen before room construction and before player loading, which is good for normal restart recovery. The defect is the lack of a shared barrier if one recovery fails but the process continues running and another store accepts writes.
- Both transaction stores write players.json directly with atomic temp-file rename and do not create the rotating players.json backup that ordinary savePlayers creates. This is a backup-policy gap, not by itself proof of data loss; decide whether transaction commits should create a recoverable pre-commit backup.
- **Confirmed craft job ID uniqueness gap:** the craft handler constructs IDs from player ID + millisecond timestamp + a random integer in a 100–999 range. startCraftJob validates that the ID is a non-empty string but does not reject an ID already present in the queue. claimCraftJob finds the first matching ID and removes every queue entry with that ID while granting only the selected job's output. If two jobs collide on the generated ID, claiming one can discard the other reserved job and its materials without granting its output. Collision is unlikely but possible when two jobs are created in the same millisecond with the same random suffix; a server-side unique-ID check or collision-free ID generation is required. Existing craftingQueue.test.ts does not cover duplicate IDs.
- Craft claim itself is otherwise guarded by job existence and finishAt, and a successful claim removes the job before the notice/save path. A second sequential claim for the same unique ID is rejected once the first claim has been saved; request-level idempotency remains a separate broader reliability concern already recorded.

No gameplay code was changed. These findings are added to the persistence/crafting correction backlog; all evidence remains source-level pending runtime tests.


### Additional generated-identifier collision review — 2026-11-10

- The same timestamp-plus-small-random-suffix ID pattern is used for auction lots: lot IDs contain seller ID, Date.now(), and rand(100,999). Auction lot validation checks that each ID is a non-empty string but does not enforce uniqueness across the active listing array. Two listings by the same seller created in the same millisecond with the same suffix can therefore share an ID. The client may render duplicate keys, and cancel/buy operations select the first matching ID. This is a low-probability collision, not a normal-path duplication exploit; generate collision-resistant IDs and validate uniqueness at the transaction boundary.
- Craft job IDs have the more consequential collision behavior recorded above: a claim finds the first matching job but filters out all jobs with that ID, potentially discarding another job's reserved materials and output. Both auction and crafting should use cryptographically random identifiers or a monotonic per-player sequence and reject duplicates server-side.
- The audit re-confirmed two previously recorded accepted defects still present in the source: weekly challenge rollover is only performed on successful hunt, not at claim time; and clanSeasonReward calculates rank from the top-ten display board, so clans outside the displayed ten receive rank 0 and are assigned the top-three fallback reward tier. These remain queued for the post-audit fix pass.

No gameplay code was changed.


### Clan-war timing and identifier review — 2026-11-10

- **Configuration requiring product confirmation:** clan-war attack cooldown is hard-coded to 1,000 ms in CLAN_WAR_ATTACK_COOLDOWN_MS. The handler enforces it per player, and the timestamp is stored in the war record. Unlike the mining cooldown, no approved production timing for clan-war attacks is present in the audit requirements reviewed so far. Do not classify this as a confirmed defect or change it until the intended live interval is specified.
- **Low-probability war ID collision:** clanWarChallenge generates IDs from the current millisecond and a random integer from 100–999. The handler does not check the generated ID against existing war IDs before appending. A collision could make a later attack/list lookup resolve the wrong war record. Use a collision-resistant identifier and enforce uniqueness before persisting.
- Inventory removal, salvage, chest opening, and potion use validate the requested item/index against the current server-side inventory before mutation. Salvage and discard additionally support expected item ID and stack-count checks; chest opening supports expected chest count. No item duplication or free-consumption path was confirmed in these reviewed handlers.
- Daily reward and race-daily state use UTC date keys. The race-daily helper resets progress and claim IDs when the UTC day or character race changes. Weekly challenge rollover remains the previously recorded exception: the claim handler still uses stored weeklyHunts/challengeWeek and does not independently roll the week before granting.
- Clan-season reward still computes rank using the already-truncated top-ten board, confirming the previously recorded rank-0 reward issue for clans outside the top ten.

No gameplay code was changed. These are source-level findings; tests were not executed.


### Combat formula cross-mode verification — 2026-11-10

- **Confirmed five-piece armor-set activation defect across combat modes:** new armor sets are generated from five armor slots (armor, helmet, gloves, boots, cloak). Ordinary hunt, PvP, and clan-war calculations count set pieces only among weapon, armor, and amulet. A five-piece armor set can therefore contribute at most one counted piece in those modes and cannot reach the two-piece activation threshold. Group expedition dungeon instead counts all equipped values and applies a different generic count-based bonus. The same set consequently behaves differently by mode; in three modes its advertised set bonus never activates.
- **Confirmed solo-dungeon ring-effect omission:** the solo dungeonRun calculation resolves weapon and armor and applies their enhancement/property modifiers, but does not resolve the equipped ring or apply its attack/defense/crit/XP/gold/lifesteal effects. The ring can still affect effective maximum health through shared health calculation, but its combat and reward effects are absent from this mode.
- **Confirmed profession-skill dead effect for Vampire blood_burst:** the skill is defined with effect lifesteal and value 0.08 and is activated by storing that effect in p.buff. Ordinary hunt's active-buff calculation handles attack/blood, defense, crit, gold, XP, and loot, but has no lifesteal branch. The Vampire's ordinary post-victory healing is already applied independently of this buff, so the skill's stored effect/value does not add the advertised 8% lifesteal. It is not a one-battle effect either: all profession buffs remain active for five minutes, as previously recorded.
- The cross-mode comparison reinforces existing findings: combat stats/equipment effects are not centralized, set bonus descriptions and implementations diverge, and active buffs are not applied consistently to solo/group dungeons, PvP, and clan wars. Treat these as a combat-system consolidation/design task rather than patching individual formulas independently.

Source-level review only; no gameplay code changed and no tests were executed.


### Weapon-profile attributes and PvP/clan-war parity — 2026-11-10

- **Confirmed weapon primary-attribute bonuses are omitted from PvP and clan-war calculations:** all 50 non-legacy weapon records in equipment_catalog.json define primaryAttribute. Ordinary hunt and group expedition dungeon call weaponProfile() and add its attribute bonuses before calculating combat stats. PvP and clan-war formulas use base strength/dexterity/intelligence plus weapon attack only; they do not call weaponProfile(). Consequently the weapon's advertised +attribute bonus is absent from both PvP and clan-war ratings. This also omits weapon-granted stamina/vitality from defensive calculations in those modes.
- **Confirmed high-tier profile-efficiency effects are also omitted from PvP/clan wars:** the catalog contains 21 high-tier weapons with +4% to +6% profile-efficiency text. weaponProfile() parses this effect; group dungeon uses its loot/profile bonuses, while PvP and clan-war formulas do not. These weapon effects therefore have no impact in those modes.
- These findings strengthen the existing requirement for a shared combat-stat calculation or explicit per-mode rules. Do not fix by copying the hunt formula blindly: PvP, clan war, solo dungeon, group dungeon, and hunt currently use different combat models and need a deliberate shared-stat contract plus mode-specific modifiers.

Source-level catalog and handler comparison only; no gameplay code changed and no tests were executed.


### Weapon profile full call-site correction and ring loot effect — 2026-11-10

- **Correction/extension to the preceding weapon-profile entry:** a call-site search confirms weaponProfile() is invoked only by group expedition dungeon combat. It is not invoked by ordinary hunt either. Thus all 50 non-legacy weapons' primaryAttribute bonuses are omitted from ordinary hunt, PvP, and clan-war calculations; group expedition dungeon is the only reviewed combat mode that applies them. The same applies to the 21 high-tier +4% to +6% profile-efficiency weapon effects: their parsed bonuses are only consumed in group expedition dungeon. (The prior entry's wording that ordinary hunt calls weaponProfile was incorrect; this entry supersedes it.)
- **Confirmed ring loot effect missing from ordinary hunt:** the non-legacy PEN-003 ring advertises an increased chance of additional resources. Ordinary hunt's loot probability includes profession, active loot buff, weapon rare property, armor rare property, and encounter modifiers, but does not include the equipped amulet's loot effect/value. Group expedition dungeon separately reads ring loot effect for drop bonus. The ring therefore does not provide its advertised hunt loot chance in the ordinary hunt mode.

Source-level call-site and catalog comparison only; no gameplay code changed and no tests were executed.


### New armor-set description versus runtime implementation — 2026-11-10

- **Confirmed set-tier descriptions are not implemented as written:** equipment_catalog.json defines tier-specific 2/5, 3/5, 4/5 and 5/5 bonuses for new five-piece armor sets. Runtime generation extracts those strings into set metadata, but group-dungeon combat does not interpret the tier text. It maps each set to one generic effect by profession and applies a generic bonus of equippedPieceCount * 1% plus mastery * 1%, starting at two pieces. For generic sets with no profession, the default mapping is defense; their advertised HP, resistance, and final HP tiers are not implemented. Other profession sets likewise do not implement their distinct 2/3/4/5-tier descriptions or unique 5/5 passive effects.
- This is in addition to the already recorded issue that ordinary hunt, PvP, and clan wars cannot count the five armor slots toward these sets at all. The only mode that counts all five slots (group expedition dungeon) still applies a different generic formula from the catalog descriptions.
- Required later decision: either implement the documented tier effects consistently in the relevant modes, or revise catalog/UI descriptions to match the chosen shared set-bonus contract. Do not infer the intended balance from the current generic formula.

Source-level catalog/runtime comparison only; no gameplay code changed and no tests were executed.


### Ring boss-damage effect coverage — 2026-11-10

- **Confirmed bossDamage ring effect is limited to group expedition dungeon:** the ring's configured effect is applied in runExpeditionDungeon() when calculating group boss attack. Ordinary hunt increases enemyPower for boss encounters but never applies the equipped ring's bossDamage multiplier; solo dungeonRun also omits ring effects entirely. The advertised boss-damage benefit therefore does not apply to ordinary hunt bosses or solo dungeons.
- Together with the previously recorded loot-ring omission, this confirms that ring effects are implemented piecemeal by mode. The later combat refactor needs an explicit effect-by-effect applicability matrix (hunt normal/rare/boss, solo dungeon, group dungeon, PvP, clan war, mining, crafting, regeneration, reputation) and tests for each advertised effect.

Source-level review only; no gameplay code changed and no tests were executed.


### Racial and profession skill values — 2026-11-10

- **Confirmed racial-skill configured values are ignored for combat buffs:** guildSkill() stores only effect name and expiry in p.buff; ordinary hunt hardcodes attack/blood +15%, defense +15%, crit +12%, XP +15%, loot +20%, and gold +15%. Catalog definitions specify Dog iron_guard +20% defense (runtime +15%), Dog pack_howl +12% XP (runtime +15%), Rodent blood_pact +10% attack (runtime +15%). The other listed racial values happen to match current hard-coded values or are not represented as a separate magnitude. Thus at least three advertised racial skill values are incorrect in live ordinary-hunt calculations.
- **Confirmed profession-skill configured values are likewise ignored:** professionSkill() also stores only effect name and expiry, while hunt uses generic hard-coded multipliers. Examples: Mage mana_surge advertises +18% but applies +15%; Warrior shield_wall advertises +22% but applies +15%; Archer eagle_eye advertises +15% crit but applies +12%; Gatherer deep_sense advertises +25% loot but applies +20%; Gatherer orebreaker advertises +12% attack but applies +15%. Vampire blood_burst is recorded separately as an unhandled lifesteal buff; its intended +18% attack text/value also is not represented by the generic buff path.
- **Buff state is lossy and mutually exclusive:** both racial and profession skill handlers overwrite the single p.buff/p.buffUntil pair. Activating one buff replaces a different still-active buff rather than allowing independent effects or explicitly rejecting the second activation. Chest buffs use the same fields. The UI can therefore imply that multiple timed buffs are independently active when only the most recently assigned effect remains. Decide intended stacking/overwrite policy and test it.
- These issues are part of the wider combat-effect consolidation: persist effect type plus configured magnitude and source/expiry, apply shared effect resolution, and test exact percentages and coexistence. Avoid changing balance values until the intended contract is approved.

Source-level comparison of skill definitions, activation handlers, and ordinary-hunt formula only; no gameplay code changed and no tests were executed.


### Home buildings, stat points and crafting progression — 2026-11-10

- **Confirmed home bonuses are fixed raw-stat increments, not percentage modifiers.** `upgradeBuilding` immediately mutates character stats: training +2 strength/level; garden +2 vitality and +10 max/current HP; library +2 intelligence; workshop +1 crafting; warehouse +1 luck. The five building levels are persisted in `p.buildings`, but a source-wide search found no other server reads of `p.buildings`; effects are baked into the raw player fields at purchase time. Client copy repeats the fixed-value descriptions. User approved redesign toward percentage bonuses. Recommended implementation: derive building modifiers from levels in centralized effective-stat functions, do not mutate base stats, and define exact affected systems. Proposed cap is +20% at level 10 (2% per level), with garden affecting max HP, workshop craft duration, warehouse resource/rare-drop chance. Training/library should apply to corresponding combat attributes consistently across hunt, solo/group dungeons and PvP/clan war only after the shared combat-stat contract is defined. Existing saves need a one-time migration or a reliable base-stat separation so historical fixed bonuses are not double-counted.
- **Confirmed stat-point system is currently dead progression.** `addXp` grants 3 `statPoints` per level, but `upgradeStat` never checks or decrements them; instead it charges gold and increments strength/defense/vitality/dexterity/intelligence. Character UI does not display statPoints. `luck` and `accuracy` are excluded from server upgradeStat even though client `statCost` contains formulas for them. User-facing description also says luck, stamina and accuracy will later become passive skills, with no implemented allocation route found. Recommendation: use earned stat points for direct attribute allocation and reserve gold for buildings/equipment, or explicitly retire statPoints and remove their generation. Do not silently keep both systems.
- **Confirmed crafting progression can be farmed via cancelled unique-item jobs.** Craft start consumes materials and increments `p.crafting` immediately. If claim finds an already-owned unique ring, `claimCraftJob` refunds materials and removes the job, but crafting level is not rolled back. Repeatedly starting and claiming such jobs allows free crafting XP. Move crafting progression to successful completion; if a refund/cancel path occurs, award no progression. Add runtime coverage for duplicate unique ring claim and repeated attempts.
- **Workshop currently grants +1 crafting per level and craft start grants +1 crafting per job.** This conflates permanent building progression with earned profession skill and bypasses the normal success condition. The proposed percentage workshop bonus should affect production time, while crafting skill should progress only from completed orders.
- **Craft time ring bonus is currently applied at job creation only.** The production ring effect is calculated when starting the order and stored in the job's `seconds/finishAt`; changing equipment afterwards does not alter an already-running job. This is reasonable snapshot semantics if clearly described. No building production-speed bonus is implemented.
- **Source-level only.** No gameplay code changed and no tests were executed in this pass.


### Attribute usage and gathering progression cross-check — 2026-11-10

- **Clarification for warehouse:** `luck` is currently read in ordinary hunt only as part of critical chance (`p.luck / 300)); no luck-based resource/drop calculation was found in the reviewed server source. Therefore the current warehouse's +1 luck per level is approximately +0.33 percentage points of hunt critical chance per level, not a general loot bonus. The proposed +2% warehouse bonus should be explicitly defined as a loot/resource probability modifier, with caps and affected modes, rather than blindly multiplying the luck stat.
- **Attribute coverage is mode-dependent:** ordinary hunt uses luck for crit chance, accuracy for hit chance, dexterity for dodge, stamina for damage reduction; group boss dungeon uses stamina in defense but does not use luck/accuracy in the shown combat stat builder; solo dungeon and PvP have separate formulas. This reinforces the need for a central effective-stat contract before applying home percentages globally.
- **Mining progression is very narrow:** `p.mining` increases on every mine action and grants one extra crystal every fifth mining action; otherwise the mining skill level does not scale crystal count or gold in the reviewed handler. Current 1-second mine cooldown is the user's test configuration; target remains 30 minutes generally and 15 minutes for Miner profession.
- **Fishing field has no active gameplay usage found:** `p.fishing` is present in Player schema but no fishing handler or progression use was found in the reviewed server source. Treat as an unfinished/unused stat, not as an exploit. Decide whether fishing is planned or remove/retire the field in a future schema migration.


### Racial and profession skills; combat-mode parity — 2026-11-10

- **Confirmed configured skill magnitudes are discarded at activation.** `professionSkill` and `guildSkill` save only an effect string in the shared `p.buff` field. Ordinary hunt then hardcodes generic values: attack/defense +15%, crit +12%, loot +20%, XP/gold +15%. Thus skill catalog values (e.g. +18%, +22%, +25%, +12%) are not authoritative and several descriptions disagree with actual output.
- **Confirmed profession skill duration contradicts copy.** Catalog says most profession skills affect the “next battle”; activation stores a 5-minute buff, and ordinary hunt does not consume it after one battle. Repeated hunts within 5 minutes all receive it. Cooldown is 60 seconds, so a player can activate a skill again while its previous buff is still active; because there is one shared slot, the later effect replaces the previous one. Clarify whether skills are single-next-battle or timed buffs; implement exactly one model.
- **Confirmed race skill duration is 10 minutes and cooldown 30 minutes**, but all effects also share `p.buff` / `p.buffUntil`, so racial skill, profession skill, and chest buffs overwrite each other. The Rodent blood skill heals 12% max HP and sets attack buff; its configured +10% value is ignored in favor of generic +15% attack.
- **Confirmed Vampire profession skill is ineffective as advertised.** `blood_burst` has effect `lifesteal` and description promises +18% attack plus post-victory healing, but activation stores `p.buff='lifesteal'`; ordinary hunt has no buff branch for that value. Vampires already have a separate passive heal after victory, but the skill itself adds no extra attack or lifesteal. This should be corrected using a structured skill payload rather than adding another string special case.
- **Confirmed combat-mode inconsistency:** timed buffs are read in ordinary hunt only. Solo dungeon's formula does not read `p.buff`; group boss dungeon stats also do not apply these buffs. Solo dungeon has a partial profession model (attribute weighting, Warrior/Buffer defense, Vampire/Buffer victory healing, Gatherer bonus resource chance), but omits ordinary-hunt class crit/hit/damage-reduction passives. Equipment ring attack/defense/XP/gold/loot effects and most rare equipment properties are not applied in solo dungeon; shared max-HP effects remain through `effectiveMaxHealth`. Group boss dungeon has its own formula and only applies a subset of ring effects. PvP and clan war have separate formulas. A mode/effect matrix is required before centralizing balance.
- **Race identity currently has no general always-on racial combat passive in the reviewed formulas.** Racial differentiation is through race-specific profession choices, home territory access, daily race assignments/reputation, and activated guild skills. The three daily tasks per race share the same structure (hunt wins, home-zone wins, mine action) with differing zone IDs and small reward differences. If permanent racial passives are intended, they are not present in the reviewed server combat logic.
- **Confirmed solo dungeon equipment gap:** attack/defense formulas use only weapon and chest armor, and set counting uses only weapon, chest armor and ring. Helmet, gloves, boots and cloak are omitted, despite existing slots and group boss dungeon's five armor slots. The report also omits these four slots.
- **No gameplay changes in this audit pass; source review only, tests not executed.**


### Ring progression formula and cap discontinuities — 2026-11-10

- **Confirmed level-100 discontinuity in 10 of 11 new ring effects.** `pendantEffectValue` returns `rate * level` below level 100, but switches directly to the cap at level 100. For effects with rate 0.1% per level and cap 20%, level 99 gives 9.9% and level 100 jumps to 20%; for defense/crit at 0.05% per level and cap 10%, level 99 gives 4.95% and level 100 jumps to 10%. Only XP (0.5% per level, 50% cap) is continuous at level 100. Recommendation: calculate `Math.min(cap, rate * level)` for every level, unless the large final-level bonus is explicitly intended and balanced.
- **Catalog metadata mismatch:** PEN-005 (defense) and PEN-008 (crit) declare `value: 0.001` while the effect-rate map uses 0.0005 and their descriptions state 0.05% per level. The runtime map is authoritative today, but catalog consumers may display/use the incorrect value. Align catalog `value`, description and runtime source of truth.
- **Ring effect coverage remains inconsistent by mode.** XP and gold bonuses are used in ordinary hunt and group boss dungeon; loot chance only in ordinary hunt; production only when a craft job starts; regen only in periodic health regeneration; crystal chance only in mining; boss damage only in group boss dungeon; reputation only at initial faction choice; health through `effectiveMaxHealth`; defense/crit in ordinary hunt and group boss dungeon. Solo dungeon does not apply most equipped ring effects. This needs an explicit applicability table and consistent description.
- **Group boss dungeon ring effects:** the inspected stat builder applies defense, crit and bossDamage as attack multipliers; XP/gold are applied to rewards; other effects (loot, production, regen, reputation, crystalChance, health) are not direct battle modifiers, with health still affecting max HP through shared calculation.
- **Source review only; no ring logic or gameplay code changed and tests not executed.**


## Дополнение аудита: комплекты экипировки и оружейные профили (2026-11-10)

### Уточнение утверждённой модели колец
Пользователь подтвердил намеренный бонус последнего уровня: уровни 1–99 постепенно дают половину максимального бонуса, а уровень 100 добавляет вторую половину. Пример для кольца с итоговым бонусом +20%: уровень 99 = +10%, переход на 100-й = ещё +10%, итог +20%. Поэтому скачок на 100-м уровне не является дефектом. Проверять нужно соответствие формулы, каталожного `value`, описания и всех мест применения. Для колец с итоговым максимумом +10% ожидается +5% к 99-му и ещё +5% на 100-м. Существующие rates/caps следует привести к этой модели, а не сглаживать финальный уровень.

### Комплекты: подтверждённые несоответствия
Источник: `server/src/index.ts` (генерация `EQUIPMENT_SETS`, обработчики охоты, PvP, clan war, одиночного и группового подземелий), `server/data/equipment_catalog.json`.

- Новые комплекты брони состоят из пяти слотов: helmet, armor, gloves, boots, cloak. Их каталог задаёт ступени 2/5, 3/5, 4/5 и 5/5. У профессиональных комплектов тексты ступеней различаются по уровню предметов и профессии; общие комплекты обещают HP/защиту/сопротивление.
- Обычная охота, PvP и clan war считают комплект только среди `weapon`, `armor`, `amulet`. Поэтому новые пятичастные комплекты брони не активируются в этих режимах: helmet/gloves/boots/cloak не участвуют в подсчёте. Старые трёхпредметные комплекты продолжают считаться.
- Одиночное подземелье объявляет локальный `setCount` только по weapon/armor/amulet, но в расчёте боя он не используется; бонусы комплекта фактически отсутствуют.
- Экспедиционная охота и групповое босс-подземелье считают количество предметов через все значения `equipment`, поэтому новые комплекты там активируются. Однако реальный эффект не соответствует ступенчатому описанию: общий расчёт использует `count * 1%` плюс мастерство, а не отдельные эффекты 2/5–5/5. В экспедиции дополнительно есть фиксированные бонусы на 5/5 (атака/защита +5%), но это не универсальная реализация описания. В групповом подземелье отдельные формулы для атаки/защиты/крит/добычи/вампиризма.
- Мастерство комплекта требует все 5 частей и повышает внутренний бонус на 1 процентный пункт за уровень в части формул; для lifesteal используются отдельные коэффициенты. Единого согласованного контракта между каталогом, мастерством, интерфейсом и режимами нет.

Статус: подтверждённое расхождение данных и runtime. Требуется единая функция расчёта комплектов, учитывающая все пять слотов, ступени конкретного комплекта, мастерство и согласованное применение по режимам. Перед реализацией нужно зафиксировать значения эффектов 2/5–5/5 для каждого типа комплекта; нельзя автоматически трактовать текстовые описания вроде «усиление роли» как числовой эффект.

### Оружейные профили: неполное применение
- `weaponProfile()` извлекает плоский бонус `primaryAttribute` и процент профильной эффективности из каталога.
- В текущем коде функция используется в экспедиционной охоте и групповом босс-подземелье.
- Обычная охота, одиночное подземелье, PvP и clan war считают атаку по базовым атрибутам и атаке оружия, не добавляя профильный атрибут и процент профильной эффективности.
- Следовательно, один и тот же экипированный предмет даёт разные характеристики в разных режимах; высокоуровневые оружия с +4–6% профильной эффективности не получают заявленное преимущество вне двух групповых режимов.

Статус: подтверждённая неполная parity между боевыми режимами. Исправление должно использовать общую функцию профиля без двойного начисления атрибутов и без изменения утверждённой абстрактной модели PvP (сравнение рейтинга, не HP-бой).

### Ограничения проверки
Это анализ исходного кода, не результат запуска тестов. Никакие игровые формулы в этом дополнении не менялись.


## Дополнение аудита: дом и ремесло

### Дом / постройки
Текущая серверная логика `upgradeBuilding` повышает уровень до 10 и сразу навсегда прибавляет плоские характеристики:
- training: +2 strength за уровень;
- garden: +2 vitality и +10 maxHealth за уровень, также +10 текущего HP;
- library: +2 intelligence за уровень;
- workshop: +1 crafting за уровень;
- warehouse: +1 luck за уровень.

Это подтверждает, что переход к процентным бонусам дома потребует миграции, а не простой замены UI. Старые плоские прибавки находятся в сохранённых характеристиках персонажа; нужно вычислить и удалить только вклад построек по текущим уровням, сохранив рост тех же характеристик из прокачки и других источников. После миграции проверить текущий HP и ограничить его новым effective max HP. Максимальный уровень каждой постройки сейчас 10.

В текущем обычном бою `luck` участвует в формуле критического шанса (`0.04 + luck/300`); отдельного универсального бонуса к дополнительной добыче от luck в просмотренном обработчике нет. Поэтому будущий склад лучше привязать к явно определённому шансу дополнительной добычи, а не просто умножать luck. Нужно проверить другие режимы и добычу в шахте до изменения.

### Ремесло
- Уровень ремесла (`p.crafting`) повышается на +1 при запуске каждого заказа, а не при получении готового предмета. Отдельной кривой опыта/стоимости уровней в этом обработчике нет.
- Специализация выбирается один раз при `crafting >= 2`; повторно изменить её нельзя.
- Совпадающая специализация даёт 20% шанс получить дополнительную единицу результата. Для чужой специализации требуется ещё +2 уровня ремесла.
- Тип специализации выводится из результата рецепта/профессии через несколько условий; легендарные рецепты также классифицируются этим правилом. Требуется таблица соответствия рецептов специализациям и тесты на все профессии.
- Очередь ограничена тремя заказами. Материалы изымаются при запуске; награда выдаётся после завершения и отдельного claim.
- Скорость сейчас рассчитывается только по кольцу производства: `floor(recipe.seconds / (1 + ringBonus))`, минимум 1 секунда. Бонус фиксируется в длительности заказа при его запуске. Будущий процентный бонус мастерской должен складываться с кольцом по заранее определённому правилу и не менять уже запущенные заказы.
- Проверка профессии рецепта использует только основную p.profession. Это согласуется с текущим отсутствием подклассов в PlayerSchema и gameplay; не считать дефектом до появления реальной системы подклассов.

Никакие игровые формулы в этом дополнении не менялись; это исходный аудит кода, не запуск тестов.


### Каталог экипировки: структурная проверка и легендарные предметы
Проверен `server/data/equipment_catalog.json`:
- 346 записей; дублирующихся ID не найдено.
- Обязательные поля ID/name/kind/level/price заполнены; отрицательных цен и уровней ниже 1 в выборке не обнаружено.
- 50 оружий: 8 общих ранних предметов и по 7 профессиональных на уровнях 25/40/55/70/85/100.
- 285 частей брони: 5 общих комплектов на каждом раннем уровне, по 5 слотов на каждую из 7 профессий на уровнях 25/40/55/70/85, а на 100 уровне также добавлены легендарные комплекты.
- 11 колец имеют уровень предмета 1; их собственная прокачка хранится отдельно в `collections.pendantLevels`.

Балансный вопрос: все 7 легендарных комплектов 100 уровня имеют одинаковые числовые характеристики по профессиям и по каждому слоту слабее соответствующей обычной профессиональной брони 100 уровня. Например, обычный нагрудник: 432 защиты / 420 HP; легендарный: 360 защиты / 420 HP. Обычные перчатки: 130 атаки / 162 защиты / 140 HP; легендарные: 70 атаки / 135 защиты / 100 HP. Другие слоты также имеют более низкие показатели. При этом описание легендарных комплектов обещает уникальную способность, но её числовое действие не задано в каталоге, а текущий runtime не реализует единый ступенчатый контракт. Это не доказанный баг само по себе, но подтверждённый дисбаланс/неполная спецификация: до запуска легендарного крафта нужно определить численные эффекты 2/5–5/5 и проверить итоговую силу полного комплекта против обычного 100 уровня.


### Точная формула колец — уточнение после подтверждения пользователя
Для каждого кольца максимальный бонус берётся из его cap. Уровни 1–99 должны линейно набирать ровно половину cap к 99-му уровню; уровень 100 открывает вторую половину. Формула:
- при уровне 1–99: `cap * 0.5 * level / 99`;
- при уровне 100: `cap`.

Примеры: cap 20% → 99-й уровень ровно 10%, 100-й 20%; cap 10% → 5% и 10%; cap 50% → 25% и 50%. Следовательно, текущие rates нельзя считать универсально правильными: например, XP-кольцо с cap 50% и rate 0.5% за уровень даёт почти весь cap уже на 99-м уровне. Реализация должна опираться на cap и общую формулу, а не на независимые rates, чтобы все кольца соблюдали одинаковую модель.


### Повторная сверка PvP: исправлены устаревшие замечания паспорта
Повторно проверены актуальные `server/src/pvpOperations.ts`, обработчики `pvpList/pvpChallenge`, `client/src/main.ts` и тесты на текущем audit branch:
- Ограничения ±2 уровня больше нет. `selectPvpOpponents` выбирает из всех сохранённых персонажей с созданным профилем и без действующего иммунитета; уровень учитывается только как валидное числовое поле. Runtime-тест проверяет персонажей заметно ниже и выше уровня атакующего.
- Серверный `pvpChallenge` проверяет `offersExpireAt` и отклоняет просроченный список; также проверяет членство цели в текущем `offeredIds`.
- Клиентский таймер использует `cooldownUntil` и `offersExpireAt`; при наступлении срока очищает старый список и запрашивает новый. Значит, прежние замечания о ±2 фильтре, неиспользуемом клиентом сроке списка и отсутствии серверной проверки устарели и не должны оставаться открытыми дефектами.
- Четыре уникальных предложения выбираются без повторения предыдущего набора, когда доступно не менее четырёх новых кандидатов; при меньшем числе кандидатов алгоритм может повторно использовать прошлых, чтобы заполнить список.
- Известные тренировочные боты обрабатываются отдельным путём: для них пропускаются обычный cooldown, проверка предложенного списка, запись PvP-атаки и награда. Нужно подтвердить, что это намеренный режим тренировки; это не относится к реальным персонажам.

Тесты просмотрены, но в рамках этой проверки не запускались.


### Кольца: сверка всех 11 каталожных описаний с подтверждённой формулой
Повторная проверка `equipment_catalog.json` выявила:
- PEN-001 (XP, cap 50%) сейчас описывает +49,5% на 99-м уровне и +50% на 100-м. По утверждённой пользователем модели должно быть +25% на 99-м и +50% на 100-м.
- PEN-002/003/004/006/007/009/010/011 (cap 20%) описывают +9,9% на 99-м и +20% на 100-м. Целевое значение на 99-м — ровно +10%, на 100-м +20%.
- PEN-005 (defense) и PEN-008 (crit) имеют cap 10%; целевые значения — ровно +5% на 99-м и +10% на 100-м. В каталоге у обоих `value: 0.001`, тогда как описание заявляет 0,05% за уровень, а runtime rates задаёт 0,0005. Это несогласованные значения.
- Для всех колец необходимо унифицировать описание и отображаемую прогрессию по `cap * 0.5 * level / 99` на уровнях 1–99 и полный `cap` на уровне 100. Не использовать `value` как отдельную альтернативную формулу для новых колец.

Это подтверждённое расхождение текущих значений/описаний с новой согласованной моделью; пока только зафиксировано, код не менялся.


### Clan season — revalidated
Current code confirms the top-10 truncation defect: `clanSeasonBoard()` returns only 10 clans, while `clanSeasonReward` calculates rank from that truncated array. Outside-top-10 rank becomes 0 and receives 2,500 gold due to `rank <= 3`; the intended lower reward is 1,000. The earlier one-line note claiming 1,000 for rank 0 was inaccurate and has been corrected.
Additional design question: `seasonPoints` are accumulated in clan records and the inspected code has no seasonal reset/period rollover, while the reward claim marker resets weekly. Confirm whether the board is meant to be a lifetime leaderboard with weekly payout or a true seasonal leaderboard; do not reset points without defining the season boundary.


## Дополнение аудита: общая прогрессия 1–100 и базовая экономика

### Уточнение карты уровней
Уточнение после проверки клиентского интерфейса: серверный список TOWNS действительно содержит 17 локаций с диапазоном уровней 1–100, но это старый маршрут основной охоты. В актуальном клиенте нет ни одной отрисованной кнопки, вызывающей hunt; кнопка/маршрут не отображается, хотя обработчик hunt и клиентский action case остались. TOWNS используются в каталоге боссов мира, а вкладка «Охота» запускает только экспедиции. Следовательно, уровни 31–100 не имеют штатной цепочки охотничьих локаций в текущем интерфейсе. Активная экспедиционная ветка «Забытые земли» содержит 10 зон и 100 монстров уровней 1–30, поиск 900 секунд, переход 1500 секунд. Старый hunt можно вызвать прямым сообщением от модифицированного клиента, но это не штатный игровой путь.

### Кривая опыта и реальная скорость
- Серверная формула xpNeed(level)=floor(100*level^1.85); суммарно с 1 до 100 уровня требуется 17,335,649 XP. Для перехода с 99 на 100 нужно 491,954 XP; 501,187 XP — формальное значение xpNeed(100) для уровня выше текущего cap.
- Переход на следующий уровень требует от 100 XP на первом уровне до 491,954 XP на переходе 99→100.
- Старый серверный обработчик hunt даёт от 28 XP / 18 золота до 4,100 XP / 2,200 золота; редкая встреча умножает награду на 1.65, босс — на 3.2, активное событие — на 1.2. Но штатный клиент его не вызывает, поэтому эти значения не описывают доступный через UI цикл.
- Серверный cooldown основной охоты в текущем коде равен 1 секунде. На верхней локации это до 4,100 базового XP и 2,200 золота за секунду при непрерывных победах (до 14.76 млн XP и 7.92 млн золота в час без учёта редких/боссовых множителей). При этом оружие 100 уровня стоит 600,000 золота до возможных дополнительных скидок/надбавок: около 273 обычных побед верхней локации. Это несовместимо с заявленной целью долгой x1-прогрессии, если 1 секунда является реальным игровым cooldown, а не временным тестовым значением.
- Текущий штатный цикл — экспедиционный поиск 15 минут и переход 25 минут. Его нужно балансировать отдельно от скрытого старого hunt.

### Уровневые награды и локации
В старом hunt награда фиксирована и сервер проверяет только min, не max; персонаж может фармить локацию любого более низкого диапазона без снижения XP/gold. Это относится к скрытому серверному маршруту. В штатной экспедиции игрок может повторно проходить последнюю зону после её открытия; её maxLevel также не блокирует повторный фарм.

### Боевой цикл старого обработчика hunt
Скрытый старый маршрут основной охоты не использует полноценные HP/DEF конкретного монстра из бестиария экспедиции. Он генерирует один расчётный обмен:
- `dealt = attack + random - enemyPower*0.16`, с крит-множителем;
- `taken = enemyPower*0.42 - defense*0.45 + random`, со снижением от stamina/профессии;
- победа определяется условием `dealt >= enemyPower*0.55 && player.health > taken`.
У противника нет индивидуального HP, нескольких раундов, паттернов, активных атак или расходуемых навыков в этом цикле. Босс/редкий монстр — множитель `enemyPower` и награды (2.65x/1.45x), а не отдельная полноценная боевая сущность. Это существенное отличие от желаемого Dark Souls-подобного ощущения; будущая реализация требует отдельной боевой модели, а не только числового ребаланса.

### Очки характеристик — неиспользуемая прогрессия
- `addXp` начисляет 3 `statPoints` при каждом повышении уровня.
- `statPoints` — поле PlayerSchema, но в клиентском `main.ts` нет отображения или использования этих очков; серверный `upgradeStat` не списывает их.
- Вместо этого `upgradeStat` требует золото (стоимость растёт с текущим статом), увеличивает один из пяти атрибутов на 1 и для vitality добавляет +8 max/current HP. Таким образом, начисляемые за уровень очки не дают игроку механизма распределения и остаются неиспользуемыми.
- Сам уровень автоматически увеличивает maxHealth на `18 + vitality*0.5`, но не повышает силу/защиту/ловкость/интеллект. Боевой рост атаки в основном зависит от покупки/экипировки оружия и платных улучшений атрибутов.
- Нужна единая модель: либо очки уровня становятся реальным способом распределения статов, либо удаляются/заменяются другим осмысленным эффектом. Нельзя одновременно оставлять скрытые 3 очка и отдельную платную прокачку без ясного объяснения игроку.

### Региональные события — конкретное расхождение
Повторно подтверждено по `REGION_EVENTS` и `hunt`:
- Dawn описывает больше XP и репутации, Caravan — больше золота и редких перьев, Lore — больше XP и рунных осколков, Eclipse — усиленных боссов и редкие реликвии.
- Реальная общая формула для всех активных событий одинаковая: +20% к XP и золоту, +2 репутации соответствующей фракции за победу (общий дневной лимит +10), 35% шанс получить ресурс события. В частности, +20% золота применяется также к Dawn/Lore/Eclipse, а +20% XP — к Caravan; редкие перья/руны/реликвии не получают заявленного отдельного увеличения шанса. Событие не усиливает босса отдельной формулой.
- Событие выбирается по индексу UTC-дня из четырёх событий, то есть меняется ежедневно, а не по расписанию часов/недель.

### Тестовые интервалы и intended cadence
- Старый hunt: 1 секунда (обработчик остался, штатная кнопка в текущем UI отсутствует).
- Шахта: 1 секунда, хотя ранее пользователь подтвердил целевой cooldown 30 минут для всех и 15 минут для профессии Добытчик. Это пока не реализовано.
- PvP: отдельный 15-минутный cooldown уже реализован.
- Экспедиционный поиск: 15 минут; переход: 25 минут.
Для штатной экспедиции поиск 15 минут и переход 25 минут уже отображаются в UI. Старый hunt нужно решить отдельно: удалить как legacy или вернуть после полноценного боевого/экономического ребаланса. Шахтный cooldown имеет явное утверждённое целевое значение.


### Ремесло: поздняя прогрессия и стоимость легендарных комплектов
Повторная проверка `RECIPES`, `craft` и `craftingQueue.ts`:
- Для каждого из 35 легендарных предметов (7 профессий × 5 слотов) создаётся отдельный рецепт 100 уровня ремесла. Время: `7200 + level*120` секунд, то есть 19,200 секунд = 5 часов 20 минут на одну часть при уровне предмета 100.
- Каждый рецепт требует: 1 × FLDROP-10-10-A, 1 × FLDROP-10-10-B, 20 abyss_shard, 25 relic_fragment, 35 crystal_shard и 50 ash_ore. На полный пятичастный комплект это 5 редких трофеев B, 100 осколков Бездны, 125 фрагментов реликвии, 175 кристальных осколков и 250 пепельной руды.
- У Архонта Забвения шанс второго трофея FLDROP-10-10-B составляет 18%, тогда как первый трофей гарантирован. В групповом подземелье выпавшие предметы распределяются случайному участнику. С учётом 3 попыток подземелья на игрока в сутки это существенный долгосрочный gate; оценить фактический срок нужно с учётом всех альтернативных источников этих материалов и группового распределения.
- `crafting` увеличивается на +1 при запуске заказа (не при завершении) и на +1 за каждый уровень мастерской. Для рецепта 100 уровня игроку нужно набрать 100 единиц этого счётчика. Нет отдельного XP/кривой ремесла. При мастерской 10 уровня остаётся 90 запусков заказов до 100 навыка.
- Специализация даёт 20% шанс на дополнительную единицу результата для профильного рецепта; чужой тип требует +2 уровня навыка. Уникальная проверка кольца при получении безопасно возвращает материалы и удаляет заказ, если персонаж уже получил такое кольцо.
- Проверка профессии в craft использует базовую p.profession. Повторная сверка подтвердила, что activeSubclass/subclassProfession нигде не задаются и не объявлены в PlayerSchema; это не активный subclass mismatch.

Это не обязательно чрезмерная стоимость для x1, но сейчас отсутствует общий расчёт ожидаемого времени добычи редких компонентов, времени производства и времени развития ремесла. Это нужно включить в экономическую модель полного комплекта.


### Корректировка цены экипировки 100 уровня
Уточнил фактическую цену после серверного множителя: каталог содержит 600,000 золота за оружие 100 уровня, но перед отправкой магазина сервер умножает цены золотой экипировки на 1.3. Фактическая цена — 780,000 золота. Пять частей обычной брони 100 уровня вместе также имеют 600,000 в каталоге и 780,000 после множителя. Полный комплект «оружие + пять частей брони» стоит 1,560,000 золота до заточки. При 2,200 базового золота за победу в Sanctum это около 709 обычных побед за полный комплект; при текущем cooldown 1 секунда это примерно 11.8 минуты непрерывной победной охоты.


### Полный расчёт XP-пути и стоимости дома
Предыдущая модель 8,917 побед / 2 ч 28 мин относилась только к старому hunt и не является оценкой штатного цикла, поскольку клиентская кнопка его не вызывает. Её следует считать оценкой скрытого server-message маршрута, а не реальной прокачки через UI.

Проверена стоимость максимального развития пяти построек дома. Формула `floor(650*(level+1)^1.85)` даёт 185,172 золота на одну постройку 0→10 и 925,860 золота за все пять. При базовых 2,200 золота за победу в Забытом святилище это около 421 победы. С учётом текущего секундного cooldown — около 7 минут непрерывных побед для максимального дома. При этом постройки сейчас дают плоские характеристики и не требуют материалов/таймера.

### Критерий баланса основной охоты
В дальнейшем расчёте x1 нужно отдельно задать:
1. целевое активное время на путь 1→20, 20→40, 40→60, 60→80 и 80→100;
2. длительность/сложность одного боя и восстановление после поражения;
3. XP и золото за обычного/редкого/босса с учётом шанса появления;
4. цену полной экипировки каждого диапазона, заточки и дома;
5. ожидаемое количество кристаллов и редких материалов за час/день.
Нельзя балансировать только XP: при текущем золоте игрок может купить полный комплект и дом за считанные минуты из-за частоты побед.


### Критический дефект сложности всех четырёх экспедиционных подземелий
Проверена формула `runExpeditionDungeon` на персонаже без экипировки, без выбранной профессии и без покупки характеристик (базовые STR 10 / DEX 10 / INT 10 / DEF 8 / VIT 10 / STA 10). При `maxHealth = 100 + (level-1)*23` получены результаты на минимальном разрешённом уровне каждого подземелья:

| Подземелье | Мин. уровень | Босс / HP | HP игрока | Расчётные раунды | Входящий урон | Результат |
|---|---:|---:|---:|---:|---:|---|
| Склеп ржавого капитана | 5 | 7 / 850 | 192 | 1 | 5 | Победа |
| Амбар последнего урожая | 12 | 15 / 2,700 | 353 | 1 | 15 | Победа |
| Трон костяной долины | 21 | 25 / 6,500 | 560 | 2 | 78 | Победа |
| Святилище Архонта | 25 | 30 / 14,000 | 652 | 3 | 184 | Победа |

Это не предположение: подставлены реальные значения из `forgotten_lands.json` и формулы из `runExpeditionDungeon`. В проверенном пути поле `boss.hp` не участвует в условии победы. Победа определяется только тем, что расчётное число раундов <= 6 и здоровье игрока больше рассчитанного входящего урона. Поэтому все четыре подземелья можно пройти на минимальном уровне без экипировки, включая финального Архонта, и получить их награды/трофеи. Пассивные описания боссов также не реализованы полностью в этом расчёте: часть из них лишь извлекается regex для сопротивления физическому/магическому урону.

Приоритет исправления: критический. Требуется полноценная модель боя с HP босса, уроном по раундам, пассивными механиками, проверкой выживания и групповым scaling. Одного повышения `dungeon.min` недостаточно, поскольку сама формула сейчас не использует HP противника.


### Экспедиционная охота: пассивные навыки и параметры монстров реализованы частично
Повторная проверка обычного `expeditionSearchClaim`:
- HP монстра используется для расчёта количества раундов, атака — для входящего урона.
- `monster.defense` и `monster.speed` выводятся в отчёте, но не участвуют в формуле боя.
- У игрока не используются точность, удача/критический шанс, уклонение и временные `p.buff`; основа расчёта — атака, защита, выносливость, профиль оружия, сопротивление/слабость и ограниченный набор классовых бонусов.
- Пассивные навыки монстров частично извлекаются регулярными выражениями из текстовых описаний. Многие заявленные механики не исполняются: первая усиленная атака, яд, восстановление HP монстра, уклонение, снижение лечения, критический урон, снижение DEF игрока, контратака, усиление при низком HP и т.п. остаются текстом в бестиарии.
- В частности, пассив «Весь урон −20%» не попадает в обработчик, который ищет только физический/магический тип урона и несколько узких классовых формулировок. Это отличается от того, как пассив показан игроку.

Статус: подтверждённая неполная реализация бестиария. Нужна типизированная структура passive (kind/trigger/value/target/duration), а не парсинг свободного текста. При переходе к боевой модели нужно включить монстру DEF, скорость/инициативу, крит/точность, активные навыки и триггеры по HP/раундам.

### Экспедиционные подземелья обходят сюжетную прогрессию ветки
Все четыре gatekeeper-босса в обычной экспедиционной ветке находятся в диапазоне уровней 3–30 и открывают следующие зоны после победы. Однако отдельный запуск группового dungeon использует только `dungeon.min` и не проверяет, что игрок уже открыл/прошёл соответствующую зону. Финальное «Святилище Архонта» разрешено с 25 уровня, хотя сам Архонт — уровень 30 и охраняет последнюю зону.

Расчёт показал, что это не только ранний доступ: персонаж 25 уровня без экипировки проходит финальный dungeon по текущей формуле (см. критический дефект выше), получает гарантированный FLDROP-10-10-A и шанс 18% на FLDROP-10-10-B. Следовательно, можно добывать материалы для легендарных рецептов, не проходя 10 зон и не побеждая gatekeeper в экспедиции. Нужны одновременно проверка прогресса зоны на входе и исправление боевой формулы.


### Характеристики: отсутствие лимитов и неравномерный доступ к статам
Уточнение к модели характеристик:
- `upgradeStat` разрешает повышать STR/DEF/VIT/DEX/INT без проверки уровня персонажа и без максимального значения характеристики. Игрок может купить значения выше своего уровня и продолжать повышать их без hard cap/soft cap.
- Стоимость линейная: STR/DEX/INT/VIT = 100 + 7×текущее значение, DEF = 90 + 6×текущее значение. Переход всех пяти статов с 10 до 100 стоит 210,870 золота суммарно. При 2,200 золота за обычную победу в верхней локации это около 96 побед; при текущем cooldown 1 секунда — менее двух минут. Это позволяет быстро наращивать боевые параметры сверх уровня и разрушает x1-баланс.
- Уровень персонажа не ограничивает покупку характеристик; серверный `upgradeStat` не тратит начисляемые `statPoints`.
- Luck, stamina и accuracy нельзя улучшать через `upgradeStat`. В обычной охоте luck влияет на crit, stamina снижает входящий урон, accuracy влияет на hit chance; warehouse старой модели повышает luck, но отдельные способы развития stamina/accuracy не найдены. В интерфейсе эти три характеристики описаны как будущие пассивные навыки, но уже участвуют в формулах.
- Для новой модели требуется уровень-зависимый hard cap или мягкие diminishing returns; отдельно определить доступность каждой характеристики, влияние профессии и стоимость перераспределения. Не оставлять неограниченное платное увеличение статов поверх наград за уровень.


### Отдельные одиночные подземелья: формула и доступность
В дополнение к четырём экспедиционным boss-dungeon в `DUNGEONS` есть четыре самостоятельных испытания без `bossId`: минимальные уровни 8/22/40/65, сила 42/130/280/520.
- Победа определяется одним сравнением: `effectiveAttack + defense*0.65 + rand(0,30) >= power*1.35`, а выживание — сравнением здоровья с `max(1, floor(power*0.18-defense*0.18))`. Нет раундов, HP босса или индивидуальных пассивных способностей.
- Используются только оружие и слот `armor`; шлем, перчатки, сапоги, плащ, кольцо, бонусы новых комплектов, профиль оружия и большинство свойств экипировки не участвуют.
- Контрольный расчёт для 100 уровня с обычным новым оружием 100 уровня (184 атаки), обычным нагрудником 100 уровня (432 защиты), базовыми атрибутами 10/10/10/DEF8 и профессией Воин: attack 202, defense около 490.3; максимальный результат даже при rand=30 около 550.7, тогда как для Архива затмения нужно 702. Значит, персонаж не проходит самый поздний одиночный dungeon даже с обычной экипировкой 100 уровня; требуется +10 заточка, дополнительные стат-покупки или другие неочевидные бонусы.
- Уровень открытия 65 не означает фактическую достижимость испытания на 65-м уровне. Нужна таблица минимально требуемой экипировки/статов по каждому dungeon, а лучше единая многораундовая модель, использующая все слоты и реальные свойства.

Статус: подтверждённое расхождение сложности и заявленного уровня доступа; требуется числовой ребаланс после общей боевой модели.


### Финальное подземелье: крайности силы группы
Дополнительная контрольная модель для `Святилища Архонта`:
- Уровень 25 без экипировки: 652 HP, 18 атаки, 13.7 защиты, 3 расчётных раунда, 184 входящего урона — победа по текущему коду.
- Уровень 100, обычное оружие и полный обычный профессиональный комплект брони 100 уровня (5 слотов): расчётная атака около 379.5 с учётом +38 STR профиля оружия и его +6% эффективности (в фактической функции профильный бонус также умножает атаку), защита около 1,203, HP 3,777. Текущая формула даёт 1 раунд и 1 входящий урон (минимум), победа гарантирована.
- Босс имеет 14,000 HP, но оно не участвует в победе. Пять частей брони дают свыше 1,000 DEF, что полностью обнуляет расчёт входящего урона до минимума 1.

Это показывает, что проблема не просто в раннем открытии: текущая модель не сохраняет разумную кривую сложности между персонажем без экипировки и endgame-персонажем. Нужно использовать HP босса, его DEF, активные механики и scaling по числу участников.


### Клановые войны: 1-секундный боевой интервал
Проверены `clanWarOperations.ts` и обработчик `clanWarAttack`:
- Война длится 24 часа; cooldown на каждого участника — 1,000 мс.
- Урон — абстрактная разница между боевой силой атакующего и базовой силой вражеского клана; HP/защиты конкретного защитника нет.
- За 24 часа один активный персонаж теоретически может нанести до 86,400 атак. Это делает исход войны преимущественно функцией непрерывного онлайна/частоты нажатий, а не состава клана, тактики или подготовки.
- Клиент не показывает отдельный таймер атаки, только серверное сообщение «Следующая атака через 1 сек.». Кнопка защищена временным pending-action, но после ответа доступна снова.
- Тесты закрепляют 1-секундный интервал, но пользователь не утверждал его как целевой live-таймер. В рамках x1-баланса нужно определить cadence; разумная отправная точка — не чаще одной атаки в 15 минут на персонажа (96 атак за 24 часа), с UI-таймером и тестами, если не будет выбран другой темп.

Статус: подтверждённый балансный риск, не доказанный exploit сохранения/транзакций.


### Кольца: уровневые эффекты скрытого legacy hunt и несоответствие критического кольца
Подтверждено по `hunt` handler:
- Для скрытого legacy-обработчика `hunt` XP/gold/defense/crit читаются через `amulet.value` напрямую, без `pendantEffectValue` и уровня кольца; `loot` ring также не включён. Это относится только к старому маршруту, который текущий клиент не вызывает штатно.
- В активной экспедиции `expeditionSearchClaim` использует `pendantEffectValue` для XP/gold/defense/crit и loot, поэтому прокачка этих колец учитывается. Однако crit ring не даёт заявленный шанс критического удара: в экспедиционной формуле он применяется как `atk *= 1 + pendantValue*0.5`, то есть как небольшой бонус атаки. В активной экспедиционной модели нет реального расчёта crit chance/critical hit.
- HP ring рассчитывается через `effectiveMaxHealth`; production — в craft; regen — в периодической регенерации; reputation — только в момент первоначального выбора фракции; crystalChance — в шахте; bossDamage — против боссов экспедиции/подземелий. Эти эффекты имеют разную область применения.
- Клиентский расчёт HP-кольца в верхней панели также использует `0.001 * level` до 100-го уровня, а не согласованную формулу половины cap к 99 и полного cap на 100-м.

Статус: подтверждённое несоответствие критического кольца активной боевой модели и отдельный legacy-дефект скрытого hunt. Исправление должно централизовать effectValue и отдельно задать применимость каждого эффекта по режимам, не допуская пропуска и двойного начисления.


### Заточка +10: обещанный бонус оружия не реализован
Клиентская вкладка заточки обещает на +10:
- оружие: +8% боевой атаки для Боевого мага/Ассасина/Лучника/Вампира;
- оружие Добытчика: 25% шанс дополнительного ресурса;
- нагрудник: +8% защиты для Воина/Баффера.

Сверка обработчиков:
- Дополнительный ресурс Добытчика при оружии +10 реализован в основной охоте.
- +8% защиты от нагрудника +10 реализованы в основной охоте через `armorLevel>=10`.
- +8% атаки от оружия +10 для Боевого мага/Ассасина/Лучника/Вампира не найдено ни в основной охоте, ни в solo dungeon, ни в group boss dungeon, ни в PvP/clan war. Значение `weaponLevel` там лишь усиливает базовую атаку предмета на 4% за уровень.
- Бонус нагрудника +10 тоже не переносится в остальные режимы; там действуют только базовые классовые коэффициенты.

Статус: подтверждённое несоответствие UI и runtime. Требуется общая функция расчёта заточки, чтобы описание +10 работало одинаково во всех режимах.


### Заточка +10: ожидаемая стоимость при текущих шансах
Рассчитана математическая ожидаемая стоимость достижения +10 из +0 по текущим шансам успеха (95/90/85/75/65/55/45/38/30/25%), расходу материалов до броска и правилу «неудача снижает уровень на 1». Это не тест, а расчёт цепи переходов:
- Без печатей: около 180.5 попыток и 1,931,139 золота в среднем на один предмет до достижения +10. Ожидаемый расход: ~346 ash_ore, ~245 rune_shard, ~53 crystal_shard и 4 abyss_shard на один предмет.
- С печатью на каждой попытке: около 20.2 попытки, ~272,161 золота и ~20,217 кристаллов на печати; материалы в среднем ~42 ash_ore, ~35 rune_shard, ~18 crystal_shard и 4 abyss_shard.
- В полном комплекте из оружия и пяти частей брони эти ожидаемые величины умножаются на 6. Реальная дисперсия высокая: отдельный игрок может потратить намного меньше или больше среднего.

Это очень дорогой endgame sink, особенно без защиты. Для x1 это может быть осознанной долгосрочной целью, но перед ребалансом нужно сравнить ожидаемую стоимость заточки с ценой предмета, ежедневным доходом и доступностью материалов. Нельзя балансировать только отображаемую цену одной попытки.


### Валюты: источники кристаллов и самоцветов
Повторная сверка всех упоминаний `p.crystals` и `p.gems` в сервере:
- Игровые источники кристаллов: шахта (1–3 за действие, +1 каждый 5-й раз, возможен бонус кольца), босс основной охоты (2–6), сундук (3–12 в одной из веток), отдельная награда за владение Кристальным двором. Остальные найденные изменения — списания или тестовый admin.
- Для самоцветов (`gems`) не найдено ни одного игрового источника: есть только поле сохранения, тестовая admin-команда и обмен 1 самоцвета на 10 кристаллов. Если это будущая премиальная валюта, нужен отдельный платёжный источник; если игровая — сейчас она недоступна обычному игроку.
- Все материалы в магазине покупаются за кристаллы. Например, цена ash_ore 450, abyss_shard 900, crystal_shard 260, relic_fragment 1,500 кристаллов. Материалы для одного легендарного предмета (50 ash, 20 abyss, 35 crystal, 25 relic) обошлись бы в 87,100 кристаллов при полной покупке в магазине; полный пятичастный комплект — 435,500 кристаллов, без учёта двух боссовых трофеев на часть.
- Это показывает, что кристаллы — долгосрочная вторая экономика, а не мелкая награда. При целевом cooldown шахты 30 минут (15 минут для Добытчика) цены колец, заточки с печатями и материалов нужно оценивать через дневной/недельный приток кристаллов, а не через тестовый интервал 1 секунда.


### Реальная прокачка через штатную экспедицию: 25→100
После открытия и зачистки зоны 10 («Сердце забвения») обычный пул содержит 9 монстров со средним XP 576.67; страж Архонт появляется с вероятностью 5% и даёт 2,400 XP. Среднее значение XP за один поиск после зачистки — около 667.83.
- При поиске каждые 15 минут максимум составляет 96 поисков в сутки (если поддерживать цикл круглосуточно): около 64,112 XP/сутки в зоне 10 без кольца.
- Суммарно для уровней 25→100 требуется 17,016,420 XP. Только повторением зоны 10 это около 265 суток непрерывного расписания 96 поисков/сутки.
- Три ежедневных входа в финальное групповое подземелье дают ещё 18,600 XP/сутки (6,200 за вход); с ними срок по текущему коду около 206 суток. Но это включает найденный критический bypass: персонаж 25 уровня без экипировки проходит Архонта, поэтому этот расчёт не является целевой сложностью после исправления боя.
- Если персонаж способен проходить три одиночных «Архива затмения» по 8,200 XP, это 24,600 XP/сутки вместо группового dungeon и срок около 192 суток; при XP-кольце на cap +50% — около 141 суток. На обычной экипировке 100 уровня этот solo dungeon всё ещё не проходит без дополнительных усилений/заточки.
- При 8 часах активного цикла в день (32 поиска) и трёх финальных групповых входах это около 40,000 XP/сутки и 426 календарных дней; с кольцом XP +50% — около 336 дней. Это теоретическая модель без поражений, пропусков, квестов и дополнительных наград.
- В текущем клиенте после 30 уровня нет новых зон, новых уровневых диапазонов монстров или отдельной цепочки высокоуровневых экспедиций. Это ключевой пробел контента 31–100, даже если технически XP можно получать повторением одной зоны.

### Старый маршрут hunt — недоступен через штатный интерфейс
Проверены все вызовы button('hunt'...), data-action="hunt" и switch-rendered views в client/src/main.ts: ни одна отрисованная кнопка не вызывает hunt. Клиентский action handler case 'hunt' и серверный onMessage('hunt') остались, но штатная вкладка «Охота» использует только expeditionSearchStart/Claim. Это означает, что старый маршрут можно вызвать только вручную/модифицированным клиентом. До релиза нужно либо удалить legacy handler, либо спроектировать его как отдельную активную систему с защитой от обхода UI и согласованными таймерами.


### Городские NPC, сбор ресурсов и почта: незавершённые интерфейсные маршруты
Проверены все NPC из city_npcs.json и переходы в client/src/main.ts:
- Два NPC с service=gathering (садовник Изумрудной долины и оценщик Золотых дюн) ведут в раздел guilds, а не к сбору ресурсов. Отдельного серверного gathering handler нет.
- PlayerSchema содержит fishing и lastWorkAt, но эти поля не используются ни сервером, ни клиентом; обработчиков рыбалки/работы не найдено. Это незавершённые заглушки, не активные системы.
- Вкладка «Почта» фактически показывает quests.activityLog и боевые отчёты. «Выделить все» работает только локально; «Прочитать все» лишь показывает toast и не сохраняет read-состояние; «Удалить прочитанные» не имеет обработчика. Отдельное поле p.mail сервером не наполняется. Следовательно, это журнал событий с визуальным оформлением почты, а не полноценная почтовая система.

Статус: UX/feature gaps. Для релиза нужно либо подключить настоящие функции сбора/почты, либо переименовать и убрать неработающие действия, чтобы интерфейс не обещал игроку отсутствующие механики.


### Ремесло: уровень навыка можно прокачать дешёвыми заказами
Уточнение к ранее зафиксированному росту p.crafting:
- Каждый запуск любого рецепта даёт ровно +1 к crafting независимо от уровня/сложности рецепта, стоимости материалов и количества результата; увеличение происходит сразу при постановке заказа, до завершения/получения результата.
- Рецепт field_potion имеет требование crafting 1, длительность 15 секунд и расходует 3 herb_material. Очередь позволяет одновременно поставить 3 заказа.
- При мастерской 10 уровня игрок начинает с +10 crafting и может получить ещё 90 уровней навыка, поставив 90 дешёвых зелий (30 заполнений очереди по 3 заказа). При последовательной обработке коротких заказов это около 7.5 минут чистого времени производства, без учёта кликов/задержек и добычи 270 herb_material.
- Следовательно, crafting 100 не отражает мастерство высокоуровневого ремесла; дорогие рецепты 100 уровня открываются количеством дешёвых запусков. Поскольку уровень повышается до завершения заказа, даже неудачно/невыгодно завершённая работа всё равно даёт уровень.
- Для x1 нужно начислять ремесленный XP за завершённый заказ, с весом от сложности/материалов/уровня рецепта; не выдавать полный уровень за каждую постановку. Проверить, чтобы возврат материалов при uniqueConflict не создавал XP/skill progress без результата.


### Повторная квалификация проверки профессии магазина/экипировки/ремесла
В текущих исходниках activeSubclass/subclassProfession встречаются только как fallback-условия в shopCatalogForPlayer, buyItem и клиентском отображении магазина. Эти поля отсутствуют в PlayerSchema и не записываются ни одним обработчиком. Поэтому разница с equipItem/craft (проверяют только p.profession) сейчас не является достижимым игровым дефектом. Исправлены более ранние формулировки паспорта: считать это legacy compatibility/future feature, а не подтверждённой ошибкой до реализации подклассов.


### Задания, расовые поручения и события не подключены к активной экспедиции
Повторная сверка old hunt и expeditionSearchClaim:
- dailyHunts/weeklyHunts, challengeWeek, lastHuntAt, faction-event progress, faction boss progress и raceDaily progress huntWins/zoneWins обновляются только в старом обработчике hunt.
- Текущий UI не вызывает hunt; он вызывает expeditionSearchClaim. Экспедиционная победа увеличивает victories/mobsKilled/bossesKilled, но не обновляет эти счётчики. Поэтому ежедневное испытание на 3 охоты, еженедельное на 15, ежедневное задание daily_hunt и все расовые задания на охотничьи победы/домашнюю зону не продвигаются в штатном игровом цикле.
- Все четыре RACE_DAILY_QUESTS содержат задачу kind=mine. Серверный обработчик mine вызывает raceDailyState и увеличивает progress соответствующего задания kind=mine. Шахтная часть расового ежедневного набора работает корректно; она не относится к дефекту expedition/hunt.
- Региональные события и faction boss encounters тоже применяются только в старом hunt. В expeditionSearchClaim нет activeRegionEvent/FACTION_BOSSES/reputation event calculation. Поэтому календарь событий на вкладке «Живой мир» отображается, но не влияет на штатную экспедиционную охоту.
- В старом hunt все эти механики есть, но кнопка вызова отсутствует в текущем интерфейсе. Это связывает сразу несколько ранее отдельных «не работает» жалоб с одной причиной: два игровых маршрута не объединены по общей регистрации побед/добычи.

Статус: критический интеграционный дефект. Требуется общий серверный pipeline событий победы/добычи/действия шахты, чтобы экспедиции и будущая основная охота одинаково обновляли ежедневные/еженедельные/расовые/фракционные счётчики и региональные эффекты.


### Контент 31–100: рецепты и подземелья
Сверка полного списка RECIPES и DUNGEONS:
- Базовый каталог содержит 11 обычных рецептов уровней ремесла 1–8 (включая 3 фракционных); далее сразу идут 35 рецептов легендарной брони уровня 100. Рецептов ремесла 9–99 нет.
- Четыре одиночных подземелья имеют минимальные уровни 8/22/40/65; четыре экспедиционных boss-dungeon — 5/12/21/25. Нет отдельного dungeon для уровней 80–100.
- Активная экспедиционная ветка заканчивается на монстрах 25–30 уровня. После этого игрок может повторять последнюю зону и использовать solo dungeon 65, но новых уровневых диапазонов врагов/боссов и высокоуровневых рецептов 9–99 нет.
- Каталог экипировки, напротив, содержит полноценные ступени до 100 уровня и легендарные комплекты. Поэтому уровневый gear progression 31–100 существует технически, но не поддержан сопоставимым объёмом активного PvE/ремесленного контента.

Статус: подтверждённый content gap. Для полноценного x1 endgame нужно расширить активную PvE-ветку и рецепты/подземелья, а не только оставить 100-level items как цель повторного фарма зоны 10.


### Исправление аудита: шахтная часть расовых поручений работает
В предыдущем дополнении ошибочно указано, что mine не обновляет raceDaily. Повторная проверка обработчика на актуальной ветке показала, что mine вызывает raceDailyState, увеличивает прогресс всех подходящих заданий kind=mine и сохраняет raceDaily в p.quests. Удалить это замечание из списка дефектов. Неподключёнными остаются только raceDaily huntWins/zoneWins, поскольку они обновляются старым hunt, а штатный UI использует expeditionSearchClaim.


### Расовые домашние зоны отсутствуют в активной экспедиционной карте
Все четыре raceDaily zoneWins требуют отдельные TOWNS зоны: cat_moonpath, dog_border, bird_windroost, rodent_mushrooms. Они есть в старом TOWNS и доступны через старый hunt handler, но не входят в EXPEDITION_DATA.zones (el1–el10). Текущий UI показывает только экспедиционную карту и не даёт штатно отправиться в эти расовые зоны. Поэтому домашние zoneWins нельзя завершить через текущий UI даже после общего подключения expedition victory counter; потребуется добавить расовые зоны в активную экспедицию или вернуть отдельную доступную систему охоты в родных регионах.


### Уточнение активной работы колец в экспедиции
Проверка активного expeditionSearchClaim показала, что для XP/gold/defense/loot он уже вызывает pendantEffectValue с сохранённым уровнем кольца. Следовательно, ранее зафиксированный пропуск уровневого бонуса касается только скрытого legacy hunt, а не текущей кнопки «Охота». В активной экспедиции остаются две отдельные проблемы: формула XP-кольца должна быть приведена к согласованной модели 50% cap к 99 уровню и 100% cap на 100-м; crit ring сейчас превращается в множитель атаки, а не в шанс критического удара, потому что crit-механики в expedition battle нет.


### Фракционные сюжетные главы заблокированы активным маршрутом
Проверены все три factionStories:
- Dawn I требует 5 побед в mistwood/whisper (factionDawnKills), которые обновляются только старым hunt.
- Dawn II требует factionBoss_dawn; Dawn III требует factionEvent_dawn — оба счётчика обновляются только старым hunt.
- Caravan I проверяет общий p.victories и может выполняться через expeditionSearchClaim. Caravan II/III требуют factionBoss_caravan/factionEvent_caravan и не обновляются экспедицией.
- Lore I требует factionRuinsKills, Lore II factionBoss_lore, Lore III factionEvent_lore; все три счётчика обновляются только старым hunt.
- В активной экспедиции нет faction boss encounter, faction event participation или привязки к TOWNS зонам.

Итог: из 9 фракционных глав только Caravan I имеет доступное условие в текущем штатном цикле. Остальные 8 не могут быть завершены обычным игровым интерфейсом. Необходимо перенести условия на события активной экспедиции или вернуть полноценный доступный основной hunt.


### Временные боевые навыки не влияют на активную экспедицию
Повторно прослежены все чтения p.buff/p.buffUntil:
- Боевые эффекты временного buff читаются только в старом обработчике hunt. expeditionSearchClaim и runExpeditionDungeon не читают эти поля.
- professionSkill и guildSkill (расовые навыки) сохраняют attack/defense/crit/lifesteal и другие эффекты в общем p.buff. Немедленное лечение работает, потому что меняет p.health; временные боевые усиления не влияют на активную экспедицию.
- Обычное благословение buff (30 минут) и бонусы mystery_chest (10 минут) также не участвуют в активной экспедиции. Поскольку поиск длится 15 минут, даже простое добавление чтения buff только на claim потребовало бы snapshot/другой модели времени; иначе 5/10-минутные навыки истекут до боя.
- Все эти навыки/предметы отображаются в интерфейсе и могут расходовать золото/кулдауны, но их боевые эффекты не меняют штатный экспедиционный бой.

Статус: критический gameplay integration gap. Нужна модель подготовки/активации навыка на этапе старта поиска и сохранение snapshot на весь бой либо бой, который игрок начинает сразу после таймера; эффекты не должны зависеть от того, онлайн ли игрок в момент claim.


### Редкие свойства идентифицированной экипировки не применяются в активной экспедиции
Проверен eqStats внутри expeditionSearchClaim:
- Формула читает weaponProfile, улучшения заточки, все пять armor slots, классовые коэффициенты, кольцо и set mastery.
- Она не читает collections.equipmentProperties вообще. Поэтому платная идентификация оружия/брони/шлема/перчаток/сапог/плаща/кольца не даёт боевого эффекта в штатной экспедиции.
- Старый hunt читает редкое свойство только weapon/armor; solo dungeon тоже только weapon/armor; group boss dungeon не читает equipmentProperties. Редкие свойства на шлеме/перчатках/сапогах/плаще не используются ни в одном из просмотренных боевых режимов.
- Это делает систему идентификации почти бесполезной для главного активного PvE-цикла, несмотря на расход кристаллов и материалов.

Статус: подтверждённый integration gap. Нужно либо включить редкие свойства всех слотов в общую боевую модель, либо ограничить идентификацию слотами, которые реально дают эффект.


### Критические и добычные бонусы комплектов не соответствуют типу эффекта
В active expeditionSearchClaim:
- set.effect=crit умножает обычную атаку на 1 + bonus×0.75; реального критического шанса/критического урона в боевой формуле нет.
- set.effect=lifesteal также умножает атаку на 1 + bonus×0.75, а затем отдельно даёт лечение через setLifesteal. Это одновременно атакующий и вампирический эффект.
- set.effect=loot умножает атаку на 1 + bonus×0.5, а в отдельной формуле дополнительно увеличивает шанс добычи. То есть бонус добычи также усиливает урон.
- set.effect=attack и defense применяются к соответствующим статам, но сами ступени каталога 2/5–5/5 всё равно не используются: runtime считает count×1% плюс mastery, а не конкретный текст setBonus.

Статус: подтверждённое несоответствие семантики эффектов и боевого runtime. При создании единой системы комплектов каждый тип должен воздействовать только на заявленную характеристику; крит должен быть настоящим crit, loot — только шансом/количеством добычи, lifesteal — лечение от нанесённого урона.


### Экспедиционное открытие зоны: случайные повторы увеличивают время зачистки
В expeditionSearchClaim выбирается случайный монстр из 9 кандидатов без исключения уже встреченных. Gatekeeper появляется только когда число уникальных seen ID уже равно 9 на момент начала следующего поиска.
- Это классическая задача coupon collector: математическое ожидание для 9 уникальных монстров — 9×H9 ≈ 25.46 поисков, а не 9. После появления последнего нового монстра нужен ещё один 15-минутный поиск, чтобы встретить gatekeeper.
- При 15 минутах это около 6 ч 37 мин на одну зону в среднем до первой попытки gatekeeper (без перехода и без учёта поражений). Для 10 зон — около 66 часов поисков плюс 9×25 минут переходов (~3 ч 45 мин), если проходить непрерывно.
- Это не случайный баг: повторы возникают из-за выбора с возвращением. Но pacing сильно зависит от удачи; игрок может встретить одного и того же монстра много раз, прежде чем увидеть последнего.
- После зачистки зона выбирает все 9 кандидатов равновероятно: в составе 6 normal, 2 rare, 1 elite, поэтому базовая частота rare ≈22.2%, elite ≈11.1%, плюс gatekeeper 5%. Если это не задуманный баланс, нужно добавить явные spawn weights в данные.

Статус: подтверждённый pacing characteristic, требует решения в x1-балансе: random-with-replacement оставить как редкость/гринд или выбирать ещё не встреченных монстров до полного открытия зоны.


### Заточка, свойства и уровни колец привязаны к ID шаблона, а не к экземпляру
Проверены enhanceEquipment, upgradePendant, discardItem, salvageItem и auctionOperations:
- equipmentEnhancements хранится у персонажа по ключу slot:itemId; pendantLevels — по itemId; equipmentProperties — по itemId. Инвентарь и аукцион передают только строковый itemId, уникального instance ID нет.
- При продаже через аукцион itemId переносится покупателю без equipmentEnhancements, pendantLevels и equipmentProperties. Продавец сохраняет свои записи; если позже купит/получит такой же itemId снова, прежняя заточка/уровень кольца/свойство применятся к новому экземпляру.
- При discardItem и salvageItem редкое свойство очищается, если копий больше нет, но equipmentEnhancements и pendantLevels не очищаются. Повторное получение того же itemId восстанавливает старую заточку/уровень.
- Аукцион показывает itemName из каталога и не передаёт/не отображает уровень заточки, кольца или редкое свойство. Поэтому продавец может выставить заточенный/идентифицированный предмет, но покупатель получит базовый предмет; это неочевидно из объявления.
- Это может быть намеренной character-bound progression, но она противоречит обычной модели Lineage2, где заточка принадлежит конкретному экземпляру предмета. Нужно выбрать явное правило: (а) upgrades bound-to-character и нельзя продавать/передавать улучшенные предметы, с понятной маркировкой; или (б) хранить instance data и переносить улучшения вместе с предметом. Текущая смесь «продаётся базовый предмет, продавец сохраняет прогресс» не должна оставаться неявной.

Статус: подтверждённая модель данных/UX несогласованность, балансная эксплуатация зависит от выбранного intended behavior.


### Стоимость прокачки колец до 100 уровня
Текущая upgradePendant формула берёт цену покупки кольца за базовую стоимость каждого уровня 2–99, а переход 99→100 стоит 100×цены кольца. Всего от уровня1 до100 — 198×базовой цены:
- PEN-001 XP: 29,700 кристаллов (последний уровень 15,000).
- PEN-002 health: 19,800 (последний 10,000).
- PEN-003 loot: 29,700 (последний 15,000).
- PEN-004 gold: 19,800 (последний 10,000).
- PEN-005 defense: 39,600 (последний 20,000).
- PEN-006 production: 29,700 (последний 15,000).
- PEN-007 regen: 14,850 (последний 7,500).
- PEN-008 crit: 49,500 (последний 25,000).
- PEN-009 reputation: 19,800 (последний 10,000).
- PEN-010 bossDamage: 59,400 (последний 30,000).
- PEN-011 crystalChance: 9,900 (последний 5,000).

Это очень долгий endgame sink, особенно при целевом mine cooldown 30 минут / 15 минут для Добытчика. Сам по себе он может быть оправдан для x1, но нужно сбалансировать стоимость максимального бонуса относительно длительности сервера и других источников кристаллов. Последний уровень намеренно является дорогим capstone и должен давать вторую половину максимального эффекта согласно согласованной формуле.


### Групповые подземелья: гарантированная добыча выдаётся только одному участнику
В runExpeditionDungeon массив drops начинается с одного гарантированного dungeon.resource; дополнительные boss.drops бросаются один раз на всю группу, затем каждый выпавший предмет распределяется случайному участнику.
- В финальном подземелье гарантированный FLDROP-10-10-A получает только один из 1–3 участников, а шанс FLDROP-10-10-B 18% также бросается один раз на группу и выпавший предмет получает один случайный участник.
- Все участники получают полный XP, золото делится на группу с округлением вниз. При трёх игроках каждый тратит один из своих трёх дневных входов, но гарантированный ресурс получает только один участник; личная ожидаемая вероятность B для каждого падает примерно втрое.
- Поэтому при текущей модели соло-фарм эффективнее группового для добычи личных материалов легендарного крафта, хотя подземелье называется групповым. Нужна осознанная модель loot distribution: личные шансы для каждого участника, round-robin/loot-master или общий shared loot с понятной системой распределения.

Статус: подтверждённое групповое распределение, балансное решение. Дополнительно усиливает важность исправления dungeon difficulty bypass, потому что соло-персонаж 25 уровня сейчас получает все дропы финального босса.


### Кольцо репутации действует только при одноразовом выборе фракции
В текущем сервере PEN-009 reputation применяется только в factionChoice к стартовой награде 15 репутации. Выбор фракции одноразовый; последующие репутационные награды (сюжетные главы, события, другие источники) не используют pendantEffectValue для этого кольца. Поэтому если игрок выбрал фракцию до получения/экипировки кольца, его эффект не сработает вообще. Описание «получение репутации» значительно шире фактического единственного применения. Нужно сделать бонус универсальным для всех источников faction reputation или явно переименовать/описать как бонус первого выбора фракции.


### Критический скрытый API-маршрут старой охоты
Хотя текущий клиент не рисует кнопку hunt, серверный onMessage('hunt') остаётся зарегистрированным и принимает прямые WebSocket-сообщения. Он использует cooldown 1 секунда и TOWNS до уровня100. Поэтому любой клиент, который знает/восстановит имя сообщения, может обойти 15-минутный экспедиционный поиск и запускать старую охоту напрямую. На верхней локации базовая награда составляет 4,100 XP и 2,200 золота за успешный бой; потенциальная частота — до 3,600 вызовов в час при непрерывных победах. Это не просто UI-заглушка, а активный серверный маршрут с альтернативной экономикой.
Приоритет: критический перед публичным запуском. До завершения нового боевого цикла нужно отключить старый handler или закрыть его серверным feature flag/версией протокола; скрытие кнопки не является защитой.


### Вкладка «Живой мир» ссылается на недоступные зоны старого hunt
Проверен client/src/main.ts:
- «Отправиться в регион» у активного события ведёт только на вкладку farm.
- Вкладка farm отображает EXPEDITION_DATA (el1–el10), а события содержат zone IDs из старого TOWNS (mistwood, ruins, frontier и т.п.). Выбрать указанную event-зону в активной экспедиции нельзя.
- Бестиарий боссов world page строится из TOWNS и обещает случайное появление боссов в охоте, но эти боссы принадлежат скрытому старому hunt handler и не входят в EXPEDITION_DATA.
Следовательно, «Живой мир» показывает события и боссов, на которых пользователь не может повлиять через штатный UI. Это прямой UX-конфликт между двумя системами.


### Шахта: целевой таймер подтверждён, но в коде всё ещё тестовая секунда
В текущем mine handler cooldown равен 1,000 мс для всех профессий; отдельной проверки profession=Добытчик нет. Утверждённое пользователем целевое правило: 30 минут для всех персонажей и 15 минут для профессии Добытчик. Шахтные raceDaily kind=mine при этом корректно обновляются. При реализации таймера нужно сохранить этот прогресс и добавить тесты на обе профессии, точную границу времени и повторный запрос.


### Базовые характеристики персонажа в активной экспедиции
В eqStats активного expeditionSearchClaim используются STR/DEX/INT для атаки и DEF/VIT/STA для защиты. Luck и Accuracy в формуле не участвуют; критический шанс и проверка попадания в экспедиционном бою отсутствуют. При этом клиент показывает эти характеристики, старый hunt использует luck/accuracy, а warehouse старой модели повышает luck.
Статус: часть отображаемых характеристик относится только к скрытому legacy hunt. До появления реальной механики hit/crit luck и accuracy не влияют на основной игровой цикл; не следует балансировать их стоимость/бонусы так, будто они уже активны.


### Переименование персонажа обходит уникальность имени
createCharacter проверяет, что имя не занято другими сохранёнными персонажами, но обработчик rename только trim/slice(0,24) и минимум 2 символа; повторной проверки уникальности нет. Любой персонаж может переименоваться в имя существующего игрока, создавая визуальную имитацию/путаницу в списках, друзьях и кланах. Исправление: единая нормализация имени и проверка уникальности на сервере для создания и переименования (с исключением текущего playerId); при необходимости добавить стоимость/кулдаун переименования как отдельное балансное решение.


### Структурная проверка трофеев экспедиции
Проверены все 125 записей EXPEDITION_DATA.dropItems и все ссылки из 100 монстров/подземелий:
- Повторяющихся ID dropItems нет.
- Все 125 трофеев используются хотя бы в одной таблице drops; неиспользуемых записей нет.
- Все monster.drops[].id и dungeon.resource ссылаются на существующие ITEM IDs.
- Материалы FLDROP-10-10-A/B, требуемые легендарными рецептами, существуют и связаны с финальным Архонтом.

Статус: структурных ошибок ссылок в экспедиционных трофеях не найдено; проблема находится в боевом/прогрессионном доступе и распределении, а не в отсутствующих item definitions.


### Структурная проверка бестиария «Забытых земель»
- 10 зон с последовательными индексами 1–10; требования уровней 1–3, 3–5, 5–7, 7–9, 9–12, 12–15, 15–18, 18–21, 21–25, 25–30.
- Ровно 10 монстров в каждой зоне: 9 кандидатов и 1 gatekeeper.
- 100 уникальных monster IDs и 10 уникальных zone IDs; все monster.zoneId существуют.
- Все монстры имеют корректные положительные HP и числовые attack/defense/speed/XP/gold; отрицательных или пустых боевых значений не обнаружено.
- Все drop chance находятся в диапазоне 0..1.
Статус: структура бестиария корректна; проблемы — не в целостности JSON, а в алгоритме открытия, боевом расчёте, неиспользуемых параметрах и недостатке уровней 31–100.


## Дополнение аудита: опыт, темп прогрессии, охота и региональные события (2026-11-10)

### Модель опыта 1–100
Текущая формула: `xpNeed(level) = floor(100 * level^1.85)`.
- Суммарная стоимость переходов с 1 до 100 уровня: 17,335,649 XP.
- Порог следующего уровня: 7,079 XP на 10-м, 54,034 на 30-м, 194,795 на 60-м, 331,677 на 80-м, 491,954 на 99-м.
- Обычные зоны дают базово от 28 до 4,100 XP за победу. Босс и редкий противник увеличивают награду множителями 3.2 и 1.65 соответственно.
- Расчётная оценка при выборе зоны с наибольшим доступным базовым XP на каждом уровне, с учётом математического ожидания редких/босс-встреч, но без квестов, ежедневных наград и бонусов экипировки: около 8,208 побед от 1 до 100 уровня. Это модельная оценка, не симуляция фактического боя.
- На 99-м уровне одна ступень требует около 109 побед в лучшей доступной зоне при среднем XP около 4,539 за победу.
- Обычная охота сейчас имеет серверный cooldown всего 1 секунду. Если он останется в релизе, теоретический нижний предел по времени на 8,208 побед — около 2.3 часа (без учёта времени игрока на интерфейс, перемещение и поражения). Это не соответствует заявленной цели «Lineage 2 x1» по темпу прогрессии. Нужно определить целевое реальное время прокачки и соответствующий XP/hour; не менять cooldown без отдельной оценки игрового цикла.
- Поля `max` у зон не проверяются сервером в `hunt`; проверяется только `min`. Значит, диапазон max — рекомендация интерфейса, а не жёсткое ограничение. Это позволяет возвращаться в низкоуровневые зоны и фармить доступные более высокие зоны после достижения их min.
- Уровень повышает max HP на `18 + vitality * 0.5` за уровень и выдаёт 3 `statPoints`; сами основные боевые атрибуты автоматически не растут. Отдельный `upgradeStat` повышает силу/защиту/живучесть/ловкость/интеллект за золото и не тратит `statPoints`. Ранее отмеченная проблема неиспользуемых statPoints подтверждается как системная: нужно определить, будут ли они реальной наградой уровня или удалить/переименовать, чтобы не обещать игроку бесполезные очки.

### Обычная охота: модель боя
- Сервер не использует отдельный HP монстра для обычных TOWNS. Победа определяется сравнением разового урона игрока с порогом `enemyPower * 0.55` и проверкой, что персонаж пережил ответный урон. Вся встреча разрешается одним вычислением, а не последовательностью раундов.
- Мощность встречи: обычная = zone.power, редкая = ×1.45, босс = ×2.65. Награда соответственно ×1, ×1.65, ×3.2.
- Игрок получает ответный урон даже при победе. При поражении отдельной награды XP/золота нет; проверка поражения и точная формула потери здоровья должны быть включены в боевой аудит.
- Это текущая упрощённая rating-модель, а не Souls-подобный бой с HP, сериями атак, окнами действий и фазами противника. Смена архитектуры боя — отдельная крупная задача; баланс цифр нельзя считать финальным, пока не решено, сохраняем ли одношаговую модель.

### Региональные события: подтверждённое расхождение
Каталог событий обещает разные эффекты:
- Dawn: больше XP и репутации;
- Caravan: больше золота и редких перьев;
- Lore: больше XP и шанс рунных осколков;
- Eclipse: усиленные боссы и редкие реликвии.

Текущий runtime делает одинаковое для всех четырёх событий:
- +20% к золоту и XP за победу в активных зонах;
- +1.2 процентного пункта к шансу появления босса;
- +2 репутации соответствующей фракции за победу, дневной лимит +10;
- 35% шанс получить заданный ресурс события.

Дополнительно:
- Боссы в активном событии не получают отдельного множителя силы: boss power остаётся ×2.65, как и вне события.
- Caravan получает storm_feather как гарантированно выбранный event-resource с вероятностью 35%, а не отдельный повышенный шанс редкого пера; Lore аналогично получает rune_shard; Eclipse — relic_fragment.
- Dawn также получает +20% золота, хотя описание акцентирует XP и репутацию. Eclipse не усиливает босса, хотя описание это обещает.
- Региональный event-resource выпадает дополнительным отдельным роллом 35%; базовый ресурс зоны при этом остаётся прежним.

Статус: подтверждённая неполная реализация event-дизайна. Нужно либо реализовать отдельные эффекты каждого события, либо переписать описания так, чтобы они честно отражали общую формулу. Для выбранной цели игры предпочтительнее сделать события разными стратегическими окнами, а не одинаковым универсальным +20%.

### Шахта и временные настройки
- В текущем серверном обработчике cooldown шахты равен 1 секунде. Пользователь заранее обозначил это как тестовое значение; целевая настройка — 30 минут для обычного персонажа и 15 минут для профессии Добытчик. Не считать 1 секунду целевым live-балансом.
- За один заход выдаётся 1–3 кристалла, ещё +1 каждые пять добыч, плюс отдельный шанс кольца на дополнительный кристалл. Золото: случайно 12–35 плюс 2 за уровень персонажа. При текущем тестовом cooldown это потенциально бесконечный источник золота/кристаллов; при целевом 30/15-минутном cooldown экономика будет принципиально иной. Настроить доходность только после включения целевого таймера и расчёта стоимости кристальных предметов.

### Ограничения
Это аудит исходного кода и расчётная оценка по текущим формулам. Тесты не запускались, балансные значения не менялись.


### Фракционная экономика неравномерна в активном цикле
Проверены FACTIONS, factionStories, factionChoice, factionBuy и active expedition:
- Первоначальный выбор даёт 15 faction reputation.
- Глава I каждой фракции даёт +15, но через активную экспедицию выполнима только Caravan I (8 общих побед). Dawn I требует factionDawnKills из старого hunt; Lore I — factionRuinsKills из старого hunt.
- Следовательно, при текущем UI Caravan может достичь 30 репутации, а Dawn/Lore остаются на 15 (если не использовать скрытый legacy hunt).
- Dawn shop: archive_tonic rep10 доступен всем с выбором; dawn_charm rep30 недоступен без Dawn I. Dawn recipe требует20.
- Caravan shop freeblade требует30, recipe требует40. После Caravan I игрок имеет30, то есть может купить предмет, но ещё не открыть рецепт.
- Lore shop archive_tonic rep10 доступен, dawn_charm требует50; recipe требует60. Lore I недоступна.
- Региональные события и faction bosses, которые должны давать последующую репутацию/главы, также существуют только в старом hunt.
Итог: выбор фракции создаёт разный доступ к прогрессии из-за неинтегрированных условий, а не из-за осознанного баланса. Требуется перенести фракционные победы/боссов/события в активную экспедицию и выровнять первые этапы репутации.


### Экспедиционный boss-dungeon не требует группы
runExpeditionDungeon использует group.members, если группа есть, но при отсутствии группы автоматически запускает бой с ids=[this.playerId]. Проверки минимального размера группы нет. Поэтому «групповое» подземелье можно проходить в одиночку; при текущем дефекте boss HP/победы это особенно выгодно, поскольку одиночный игрок получает все дропы и не делит гарантированный ресурс.
Статус: требуется решение дизайна. Если это group-only контент — добавить минимальный размер группы 2/3; если solo разрешён — отдельный scaling и индивидуальная таблица наград, чтобы групповой режим не ухудшал личную добычу.


### Недельная награда клана использует другой календарь недели
clanSeasonReward рассчитывает week как floor(Date.now()/(7*24*60*60*1000)), то есть граница недели привязана к Unix epoch и приходится на четверг UTC. Weekly challenge использует ISO week (понедельник UTC). Если игрок ожидает единый недельный reset, клановая награда сбрасывается в другой день. Дополнительно seasonPoints не сбрасываются, поэтому «сезонный» рейтинг сейчас фактически накопительный, а выплата — еженедельная. Нужно определить календарь и длительность сезона отдельно от rank bug.


### Городская репутация пока не влияет на доступ/экономику
cityReputation по отдельным городам повышается на +1 при первом посещении и на +10 за некоторые сюжетные главы. В просмотренном серверном коде эти городские ключи нигде не используются для скидок, доступа к товарам, квестов или услуг; реальные ограничения магазинов используют faction_* reputation. Поэтому городская репутация сейчас только отображаемый накопительный счётчик. Это может быть заготовкой будущей системы, но не следует обещать игроку игровые преимущества до появления реальных порогов/наград.


### Кланы: лидер не может передать лидерство или распустить активный клан
Проверены все 76 server message handlers:
- clanLeave запрещает лидеру выходить, если в клане больше одного участника, и сообщает «Передай лидерство или попроси участников выйти».
- Отдельного handler для передачи лидерства, исключения участника или прямого disband клана нет. disbandClanState вызывается только когда последний участник сам выходит.
- Если лидер неактивен/потерял доступ, участники не могут назначить нового лидера; лидер не может покинуть клан, пока все остальные не выйдут самостоятельно. Клановые улучшения и объявление войны остаются заблокированы на лидере.
Статус: подтверждённый social/management gap. Нужны transferLeadership и leaderKick/disband с проверкой прав и атомарным commitClanState.


## Дополнение аудита: экономика кристаллов, колец и заточки (2026-11-10)

### Кристаллы — источники и расходы
По всем найденным изменениям `p.crystals` в текущем `server/src/index.ts`:
- Основной регулярный источник — шахта: 1–3 кристалла за заход, математическое среднее 2; +1 кристалл каждые 5 успешных заходов; отдельный шанс от кольца.
- Дополнительные источники: 2–6 кристаллов за победу над боссом в обычной охоте; случайные 3–12 из одной ветки сундука; клановый поход в случае контроля Кристального двора; обмен самоцветов (но в обычном игровом коде найденный источник `gems` отсутствует, кроме административной команды).
- Расходы: прокачка колец, идентификация предметов, покупка Печати сохранения и покупки материалов/колец через магазин. Все `kind: material` товары магазин считает покупками за кристаллы, даже если их поле `currency` не задано. Например, древесина стоит 35 кристаллов, осколок реликвии — 1,500. Это важно учитывать в экономике: кристаллы одновременно являются валютой улучшения колец и валютой для закупки материалов.

### Цена прокачки колец
Текущий `upgradePendant`:
- уровни 2–99 стоят фиксированно `baseCost` за уровень;
- переход на 100-й уровень стоит `100 * baseCost`;
- суммарно с 1-го до 100-го уровня — `198 * baseCost`.

При каталожных ценах всех 11 колец суммарная стоимость максимизации всей коллекции составляет 321,750 кристаллов. Самое дорогое кольцо (300 кристаллов за базовую покупку) требует 59,400 кристаллов на прокачку до 100-го уровня. При плановом cooldown шахты 30 минут (48 заходов/сутки, среднее 2.2 кристалла за заход) это около 563 дней только на такое кольцо; для профессии Добытчик при 15 минутах (96 заходов/сутки) — около 281 дня. Это оценка только по шахте, без боссов, сундуков и прочих бонусов. Стоимость 100-го уровня — намеренно большой отдельный барьер, но её нужно балансировать вместе с целевой длительностью эндгейма.

### Заточка экипировки +0…+10
Текущие шансы успеха для уровней +1…+10: 95%, 90%, 85%, 75%, 65%, 55%, 45%, 38%, 30%, 25%. Стоимость попытки — 250 × следующий уровень². Материалы требуются с +3, +5, +8 и +10. При неудаче без Печати уровень падает на 1 (не ниже +0); с Печатью сохраняется текущий уровень. Печать расходуется и при успехе, и при неудаче.
Математическое ожидание для одного предмета с +0 до +10 при этих шансах:
- без Печатей: примерно 180.5 попытки и 1,931,139 золота (с учётом откатов уровня и повторного прохождения ступеней);
- если защищать каждую попытку Печатью: примерно 20.22 попытки, 272,161 золота и 20.22 Печати (то есть около 20,220 кристаллов по текущей цене Печати).
Это расчёт математического ожидания, не тест симуляцией. Он показывает, что заточка +10 — экстремально дорогая эндгейм-система. Для одного предмета цена может быть оправдана как долгосрочная цель; заточка полного комплекта требует отдельного баланса, иначе может поглотить всю экономику персонажа.

### Сопоставление золотых доходов и расходов (ориентировочная модель)
При расчётной модели прокачки 1–100 через лучшие доступные зоны (около 8,208 побед) средний суммарный доход охоты составляет примерно 9.34 млн золота до квестов/ежедневных наград и экипировочных бонусов.
- Полный комплект обычной экипировки 100 уровня (оружие + пять частей брони) после серверного множителя цены ×1.3 стоит около 1.56 млн золота.
- Покупка полных комплектов на всех шести основных ступенях 25/40/55/70/85/100 стоит ориентировочно 3.11 млн золота, если персонаж приобретает каждую часть на каждой ступени.
- Максимизация пяти построек дома по текущей кривой стоит 925,860 золота.
- Повышение пяти покупаемых атрибутов с 10 до 100 по текущей формуле стоит около 210,870 золота.
- Максимизация мастерства одного комплекта до +10 стоит 2.75 млн золота (без учёта материалов).
Следовательно, обычный gear/home/stat прогресс в целом укладывается в модельный доход, но заточка +10 и повторная прокачка мастерства становятся главными долгосрочными золотыми поглотителями. Эти оценки зависят от реального числа побед, выбора зон, ежедневных источников и будущего изменения cooldown.

### Статус
Новые числовые значения не применялись. Это аудит существующей экономики и расчёт ожидаемых расходов; фактическая балансировка начнётся после завершения сверки источников и расходов всех валют.


### Кланы: общие действия могут запускать любые участники и тратить общие cooldown/казну
clanTerritoryCapture не проверяет, что инициатор — лидер/офицер, хотя тратит clan.vault и устанавливает общий cooldown 6 часов; неудачная попытка также расходует казну и cooldown. clanRaid тоже не проверяет роль: любой участник может запустить проверку по своему личному уровню и установить общий cooldown 30 минут; неудача блокирует остальных на полчаса. В то же время clanUpgrade и clanWarChallenge явно leader-only.
Статус: permission/griefing risk. Решить, должны ли рейд/захват быть доступны любому участнику или только лидеру/офицерам; если доступны всем, показать явное предупреждение об общем cooldown и расходе казны и/или добавить подтверждение.


### Характеристики персонажа: подтверждённая проблема прогрессии
Повторно сверены `PlayerSchema.ts`, серверный `upgradeStat/addXp` и экран персонажа в `client/src/main.ts`:
- За каждый уровень `addXp` выдаёт 3 `statPoints`, но интерфейс их не показывает, а серверное улучшение характеристик их не расходует.
- Игрок может повышать пять характеристик (strength, defense, vitality, dexterity, intelligence) исключительно за золото; ограничение по уровню или максимальному значению отсутствует.
- Формула стоимости линейная относительно текущей характеристики: strength/vitality/dexterity/intelligence = 100 + 7 × значение; defense = 90 + 6 × значение. Следовательно, атрибуты можно бесконечно наращивать, и боевой потенциал можно отделить от уровня персонажа.
- Luck, stamina и accuracy нельзя купить через `upgradeStat`; интерфейс сообщает, что они позднее станут пассивными навыками, но в проверенном экране они не доступны для распределения.
- Vitality даёт +8 max HP при покупке одного пункта и увеличивает прибавку max HP при каждом последующем level-up (`18 + vitality * 0.5`). Это делает её вложением с дополнительным накопительным эффектом.
- Профессия выбирается только с 20 уровня и после выбора не меняется; стартовые базовые характеристики у четырёх рас одинаковые.

Статус: подтверждённый дисбаланс/незавершённая система развития. Для целевой RPG-модели нужно выбрать единую схему: либо очки характеристик за уровень с понятным интерфейсом и пределами, либо покупка за золото с ограничениями/затратами, но не выдавать игроку 3 неиспользуемых очка на каждый уровень. Перед изменением нужно определить безопасную политику для существующих сохранений с уже вложенными атрибутами; нельзя автоматически обнулять или пересчитывать их без компенсации.

### Риск темпа прокачки из-за неограниченных характеристик
Поскольку сервер не ограничивает `upgradeStat` уровнем персонажа, персонаж может накопить золото в безопасной зоне и повышать характеристики без роста уровня. Минимальный уровень зоны блокирует только доступ к зоне, но не рост атрибутов. Это позволяет обойти ожидаемую кривую силы персонажа и усложняет настройку мобов/экипировки по уровню. Будущая балансировка должна учитывать не только уровень, но и допустимый бюджет характеристик и экипировки.


### Тестовое покрытие боевого баланса — недостаточно для безопасного ребаланса
Повторная проверка ключевых runtime tests:
- raceEquipmentRuntime проверяет только запрет экипировки предмета другой расы; в нём нет тестов колец, заточки, set mastery, rare properties или профилей оружия.
- groupDungeonRuntime проверяет сохранение победы/поражения и расход трёх дневных попыток на одном dungeon ID; не проверяет solo entry, boss HP/DEF/passives, распределение дропа, ring/buff/equipment effects и реальные пороги сложности.
- expeditionSafetyRuntime проверяет отчёт HP, восстановление orphan state, приглашение во время поиска и disconnect; не проверяет leave-during-action, одинаковость progression группы, боевой баланс и редкие эффекты.
- questRewardsRuntime проверяет однократность выдачи story/faction/daily/achievement наград, но не проверяет начисление daily/weekly/race/faction progress после expeditionSearchClaim и rollover weekly challenge.
- Не найдено специализированных runtime tests для mining cooldown 30m/15m, ring progression cap/level100, house migration, equipmentProperties, profession/guild buff effects, clan leadership transfer, duplicate rename и group loot distribution.

Статус: тесты по транзакциям/сохранению существуют, но до массового изменения баланса нужен отдельный слой unit/runtime tests для боевых формул и прогрессии; иначе нельзя подтвердить, что цифры работают одинаково во всех режимах.


### Клиент: сравнение экипировки не учитывает все характеристики и дубли
В character gearGrid сравнение предметов показывает только разницу attack и defense. Оно не сравнивает health, primaryAttribute/profile efficiency, заточку, редкое свойство и изменение активного set bonus. При одинаковых attack/defense UI пишет «Боевые показатели не изменятся», даже если различается HP или комплект.
Кроме того, gearItems строится по каждой записи inventory, а equippedIds проверяется по itemId. Если в инвентаре несколько копий одного itemId и одна экипирована, все копии отображаются как «Надето» и получают кнопку снятия.
Статус: UI accuracy issue; не меняет серверные данные, но может вводить игрока в заблуждение при выборе/разборе экипировки.


### Восстановление здоровья и ежедневная экономика
- Пассивное восстановление: 5% от текущего effective max HP каждые 5 минут. При максимальном бонусе кольца регенерации +20% фактический тик становится 6% max HP; восстановление применяется и при повторном входе после офлайна за прошедшие полные интервалы.
- Полное восстановление с нуля занимает около 100 минут без кольца и около 85 минут с кольцом на максимуме (6% за тик).
- При уровне 100 ежедневные источники при выполнении всех условий ориентировочно дают: daily login 1,600 XP и 1,275 золота; три расовых поручения около 1,815 XP и 2,870–2,880 золота; daily challenge 90 XP/180 золота; daily hunt 180 XP/300 золота; fountain в среднем около 33 золота/день; три успешных входа в Eclipse Archive — 24,600 XP и 15,600 золота; weekly challenge в среднем ещё около 43 XP и 100 золота в день.
- Шахта на целевом cooldown 30 минут даёт на 100 уровне в среднем около 10,728 золота и 105.6 кристалла в день; Добытчик при 15 минутах — около 21,456 золота и 211.2 кристалла в день. Оценка предполагает 48/96 успешных заходов за сутки.
- В сумме верхнеуровневый персонаж при полном выполнении ежедневного контента может получать примерно 31 тыс. золота и 28.3 тыс. XP в день до обычной охоты; для Добытчика — примерно 42 тыс. золота в день из-за сокращённого шахтного cooldown. Это не включает случайную добычу, продажи и PvP.
- Это не доказывает инфляцию само по себе: доход сопоставляется с ежедневным потреблением, заточкой, комплектами, аукционом и покупками. Но баланс нельзя считать только по охоте — дневные источники являются существенной частью экономики.

### Уточнение оценки прокачки
Ранее приведённые ~8,208 побед — оценка XP-объёма при выборе зоны с максимальным доступным XP и при условии, что каждая встреча завершается победой. Она не моделирует фактическую вероятность победы, расход здоровья, пассивную регенерацию, зелья, поражения, ежедневные подземелья и ежедневные награды. Это идеализированная оценка числа побед, а не обещание времени достижения 100 уровня.


### Ремесло: уточнение фактического каталога и пути к 100 уровню
После выполнения retirement-цикла для legacy-экипировки в видимом каталоге остаются только три обычных рецепта:
- Походное зелье: ремесло 1, 15 секунд, 3 лесные травы.
- Эликсир глубин: ремесло 3, 30 секунд, 2 травы + 1 кристальный осколок.
- Эликсир дозорного: ремесло 3, 75 секунд, 4 травы + 1 кристальный осколок.
Все прежние рецепты оружия/брони/колец удаляются из активного каталога как legacy-результаты. Дополнительно автоматически генерируются рецепты 35 частей легендарной брони: все требуют ремесло 100, 19,200 секунд (5 ч 20 мин) и одинаковый пакет материалов: 1 трофей Архонта, 1 редкий материал Архонта, 20 осколков Бездны, 25 фрагментов реликвии, 35 кристальных осколков и 50 пепельной руды.
Так как `p.crafting` увеличивается на +1 при каждом запуске заказа, ремесло 100 можно набрать повторением самого дешёвого 15-секундного зелья. Навык не зависит от уровня/сложности рецепта, стоимости материалов, успешного claim или качества изготовленного предмета. Это создаёт оптимальный путь прокачки «спамить самый дешёвый рецепт», а не развивать ремесло через разнообразные рецепты.
Специализация при совпадении с рецептом даёт 20% шанс на дополнительную единицу результата. Эта прибавка действует и на легендарные части экипировки, то есть дорогой рецепт может выдать две одинаковые части за один заказ. Для редкого endgame-снаряжения это потенциально слишком сильное влияние на предложение аукциона; требуется отдельный балансный коэффициент для обычных расходников и уникальной/легендарной экипировки.

Статус: подтверждённая проблема прогрессии ремесла и потенциального избытка легендарных предметов. Перед правкой определить отдельную формулу опыта ремесла (по рецепту/редкости/времени), лимит специализации и допустимость удвоения экипировки.


### Клановая война: подтверждённый риск темпа атак
- `CLAN_WAR_ATTACK_COOLDOWN_MS = 1_000` — не только тестовое значение в UI: его использует серверная операция и прямо проверяет unit-тест.
- Война длится 24 часа; каждый участник может наносить накопительный урон раз в секунду, без расхода ресурса, энергии или суточного лимита.
- Даже если разница силы отрицательная, `calculateClanWarDamage` гарантирует минимум 1 урон за атаку. Поэтому длительная серия атак позволяет накапливать урон даже слабому персонажу.
- Теоретически один участник может провести до 86,400 атак за 24 часа. Результат войны определяется суммой урона к концу срока; значит, исход зависит от возможности непрерывно спамить кнопку, а не только от силы клана/экипировки.
Статус: подтверждённый дисбаланс боевого таймера. Для x1-модели требуется ограниченный темп: например, отдельный cooldown на участника, лимит попыток или ресурс атак. Значение нужно согласовать с длительностью войны и PvP; 1 секунда не подходит для накопительного 24-часового режима.


### Критическая уязвимость: утечка playerId через clanList/clanWarList позволяет захватить гостевые аккаунты
Проверена цепочка server/src/index.ts:
1. clanList handler не вызывает requireCharacter и публично отправляет для каждого клана поле leader=x.leader. Это настоящий внутренний playerId, установленный при clanCreate как this.playerId.
2. clanWarList handler также не требует персонажа. Он передаёт в broadcastClanWarList полный объект каждой активной войны, включая lastAttackAtByPlayer — объект, ключами которого являются настоящие playerId атакующих. Запрашивающий клиент получает payload напрямую через c.send.
3. broadcastClanOverview рассылает clan members payload с настоящим leader ID всем участникам клана.
4. POST /auth/guest принимает любой syntactically valid playerId длиной 12–64, если он не связан с registered account, и выдаёт новую сессию. Для существующего гостевого playerId не требуется предъявить предыдущий guest token.
5. Следовательно, любой подключённый игрок может получить guest leader/war attacker ID из публичного сообщения, вызвать /auth/guest с этим ID и получить новую сессию владельца. Это прямой account takeover для незарегистрированных guest characters. Лимит 10 auth-запросов/15 минут не устраняет атаку, так как известный ID требует одной попытки.

Приоритет: CRITICAL / блокер публичного запуска.
Обязательное исправление:
- Во всех клиентских payload заменить playerId на publicPlayerCode(id); не отдавать raw playerId ни в clanList, clan overview, clanWarList, group, friends, PvP и любых диагностических данных.
- В clanWarList не отправлять lastAttackAtByPlayer map с внутренними ID; заменить на массив/словарь публичных кодов либо полностью скрыть внутреннюю структуру.
- POST /auth/guest должен выдавать новую сессию только для нового playerId, созданного сервером, либо требовать действующий guestToken для доступа к уже существующему сохранению. Новый ID предпочтительно генерировать сервером, а не принимать произвольный существующий ID от клиента.
- Добавить runtime security tests: публичные clanList/clanWarList не содержат raw IDs; попытка получить guest session для существующего guest save без старого токена отклоняется; владелец с действующим токеном может reconnect; зарегистрированный персонаж по-прежнему защищён.
- Проверить все server send/broadcast payload на утечку playerId, не только перечисленные endpoints.

Это не относится к специально открытому admin test handler, который пользователь попросил не учитывать как дефект в одиночном тестовом окружении. Утечка через клановые API — самостоятельная уязвимость и должна быть исправлена до любого публичного тестирования.


### Расширение критической утечки playerId: аукцион
Дополнительная проверка всех клиентских send payload выявила ещё два источника:
- auctionList не требует персонажа и отправляет все активные лоты напрямую из loadAuction(). Каждый lot содержит sellerId (внутренний playerId), sellerName, itemId и цену.
- auctionHistory возвращает пользователю историю его сделок целиком; каждая запись содержит sellerId и buyerId. Следовательно, покупатель узнаёт ID гостевого продавца, а продавец — ID гостевого покупателя.
Итого подтверждены как минимум четыре семейства утечек: clanList/broadcastClanOverview (leader), clanWarList (lastAttackAtByPlayer keys), auctionList (sellerId), auctionHistory (sellerId/buyerId). Это расширяет поверхность захвата гостевых персонажей до всех продавцов на аукционе и контрагентов сделок.
Исправление должно санитизировать DTO на сервере: отдавать только publicPlayerCode и display name, а не сериализовать внутренние transaction objects напрямую. Внутренние ID должны оставаться только на сервере.


### Клановый поход: крупный повторяемый источник XP и золота
Проверен `clanRaid`:
- Общий cooldown хранится на клане (`clan.lastRaidAt`) и равен 30 минутам; нет суточного лимита.
- Успешный поход начисляет вызывающему игроку `80 + level * 12` XP и клановой казне `500 + clanLevel * 250 + playerLevel * 15` золота, дополнительно умножая золото на бонусы территорий и казны.
- Это до 48 успешных походов в сутки на один клан. На 100 уровне один персонаж может получить до 61,440 XP/сутки только от походов; казна клана получает базово до 216,000 золота/сутки до территориальных и казначейских бонусов.
- Проверка силы: `playerLevel + strength * 0.15 + defense * 0.1 + clanLevel * 5` против случайной угрозы 20–55. На 100 уровне даже персонаж с базовыми strength=10/defense=8 и кланом 1 уровня имеет силу около 102, то есть успешно проходит любую возможную угрозу. На высоких уровнях успех фактически гарантирован.
- Поход не расходует золото, энергию, материалы или личную попытку. Любой член клана может запускать очередной поход после общего 30-минутного cooldown; XP получает только вызвавший игрок, золото идёт в казну.

Статус: подтверждённый дисбаланс ежедневных источников. Это существенно ускоряет x1-прогрессию и создаёт практически неограниченный приток золота в клановую казну. Нужно выбрать: один поход в день, личный cooldown, ограничение числа походов/день, растущая угроза или награда, зависящая от реального риска. Не уменьшать награду изолированно: сначала определить целевую ценность кланового похода в общей системе ежедневных активностей.


### Уточнение impact: guest takeover можно закрепить регистрацией аккаунта
После получения новой сессии через /auth/guest атакующий располагает валидным guestToken. Текущий /auth/register позволяет связать существующего гостевого персонажа с новым username/password при предъявлении этого токена и удаляет прежние гостевые сессии при linking. Поэтому цепочка не ограничивается временным доступом: атакующий может привязать украденного гостевого персонажа к своему аккаунту и лишить прежнего владельца возможности восстановить доступ через гостевой вход.
Это подтверждает критический severity: публичный запуск блокировать до устранения raw ID leaks и выдачи guest session только владельцу существующего сохранения.


### Экспедиция «Забытые земли»: структура данных и редкость легендарных материалов
Проверен полный `server/data/forgotten_lands.json`:
- 10 зон, 100 монстров, 125 предметов добычи; ID предметов добычи уникальны, все ссылки монстров на dropItems существуют, шансы находятся в диапазоне 0–1.
- В каждой зоне 6 обычных, 2 редких, 1 элитный и 1 страж/босс (последняя зона — финальный босс). Все 4 записи групповых подземелий ссылаются на существующих боссов.
- Уровни зон идут от 1–3 до 25–30. Поиск длится 900 секунд (15 минут), переход — 1,500 секунд (25 минут). Это уже соответствует длительному x1-ритму.
- После первого полного зачистки зоны повторный страж появляется с вероятностью 5% на каждый поиск. Финальный Архонт Забвения гарантированно даёт трофей `FLDROP-10-10-A`, а редкий материал `FLDROP-10-10-B` имеет шанс 18% при убийстве.
- Следовательно, после первого зачистки вероятность получить редкий материал Архонта за один 15-минутный поиск примерно 5% × 18% = 0.9%. Математическое ожидание — около 111 поисков или 27.8 часа на один такой материал при соло-фарме без бонусов добычи. Для пяти частей одного легендарного комплекта требуется по пять трофеев и редких материалов; только пять редких материалов дают ориентир около 139 часов поисков. В группе предметы распределяются случайному участнику, поэтому индивидуальный сбор может занять ещё примерно втрое больше при равном распределении.
- Это может быть приемлемым эндгейм-барьером для легендарного комплекта в духе x1, но нужно проверить, что все 35 рецептов действительно должны требовать одинаковый Архонт-ресурс и что профессии не получают несправедливое преимущество/недостаток. До изменения drop rate надо сравнить стоимость полного комплекта, ожидаемую продолжительность поиска и силу легендарного комплекта после реализации его бонусов.

Статус: структура данных корректна; потенциально чрезмерная редкость материалов — балансный вопрос, не ошибка ссылок/данных.
