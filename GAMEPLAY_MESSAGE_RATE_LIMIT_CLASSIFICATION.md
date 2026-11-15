# Authenticated gameplay message classification — 2026-11-15

## Scope and method
Static source review of `client/src/main.ts` and `server/src/index.ts` on the current PR branch. No production code, gameplay behavior, balance, or persistence data changed. No local tests were run.

## Message surface
- Found 74 distinct event names sent by the official client.
- All 74 have matching `onAuthenticatedMessage` server handlers.
- Two server handlers, `combatHistory` and `rename`, were not found as static client sends. They remain authenticated server endpoints and should be included in policy decisions; absence from static calls is not proof they are unreachable through every client path.
- The shared authenticated wrapper validates session ownership but has no general per-player gameplay ingress limiter.

## Cost-based classification

### Read-oriented / low mutation cost (still needs a modest request budget)
`huntGroupList`, `expeditionState`, `combatHistory`, `getCatalog`, `dungeonList`, `auctionList`, `auctionHistory`, `marketHistory`, `clanList`, `clanTerritories`.

These primarily read current state and return data. Repeated requests can still consume CPU, file reads, serialization, and outbound bandwidth; they should not be unlimited.

### Read-shaped requests with mutation or transaction side effects
- `craftQueue`: calls `finishCraftJobs`, so it may settle completed jobs and mutate player inventory/queue.
- `clanQuests`: ensures clan quest state and persists when maintenance changes it.
- `clanWarList`: settles expired clan wars and ensures clan quest state; may broadcast updated clan data.
- `pvpList`: runs through shared-state transaction and can refresh/persist the player's opponent offers.
- `achievements`: handler must be treated as stateful until its progress/claim behavior is separately proven read-only.

Do not put these in a cheap read-only bucket merely because their names end in List/Queue or sound informational.

### Player writes / economy / progression
Includes character and profile changes (`createCharacter`, `rename`, `chooseProfession`, `upgradeStat`, `travel`), inventory/equipment (`buyItem`, `equipItem`, `unequipItem`, `discardItem`, `usePotion`, `openChest`, `salvageItem`, `identifyEquipment`, `enhanceEquipment`, `upgradePendant`, `upgradeSetMastery`, `exchangeGem`, `buyProtectionSeal`), rewards/quests (`daily`, `fountain`, `raceDailyClaim`, `quest`, `returnReward`), crafting (`craft`, `craftCancel`, `craftClaim`, `craftSpecialty`), buffs/skills (`buff`, `guildSkill`, `professionSkill`, `upgradeBuilding`, `factionChoice`, `factionBuy`, `mine`, `tavernGame`), and group/friend management (`friendRequest`, `friendAccept`, `huntGroupInvite`, `huntGroupAccept`, `huntGroupLeave`, expedition start/claim/travel actions).

These handlers can change Player state and/or call `notice()`, which saves the player. A rejected request that reaches `notice()` can itself cause persistence work. The future limiter must reject before handler execution and must not save for every rejected packet.

### Shared-state / multi-player / higher-cost operations
- Auction mutations: `auctionSell`, `auctionCancel`, `auctionBuy` use shared WAL transactions.
- Clan mutations and war actions: `clanCreate`, `clanJoin`, `clanLeave`, `clanDonate`, `clanRaid`, `clanUpgrade`, `clanTerritoryCapture`, `clanQuestClaim`, `clanSeasonReward`, `clanWarChallenge`, `clanWarAttack`; several broadcast to other clients and/or transact shared state.
- PvP: `pvpChallenge` performs a combat resolution and changes attacker/target state; `pvpList` is also transactional despite being list-shaped.
- Expedition: `expeditionSearchClaim` performs synchronous group combat/reward calculations, updates multiple players, creates reports, and persists the group; start/travel actions also update/persist multiple participants.
- Dungeon: `dungeonRun` executes the legacy synchronous dungeon flow and can produce rewards, reports, and durable result events.
- Other stateful actions may be individually cheaper, but still require a mutation budget.

## Safe limiter design constraints
1. Add server-side token buckets keyed by authenticated player identity, not client-provided IDs.
2. Use at least two dimensions: a general ingress budget and stricter cost classes for expensive/shared-WAL/group/broadcast handlers.
3. Keep read-oriented requests separate from mutation and expensive combat/transaction requests.
4. Preserve legitimate rapid state traffic if later identified; do not assume every client event has the same natural cadence.
5. Reject before invoking the handler. Throttle feedback must be bounded and must not call the persistence-backed `notice()` for every rejected packet.
6. Define behavior for reconnects, multiple sessions/rooms, bucket cleanup, monotonic time, and process restart. Per-player buckets in one process are not a distributed limit across multiple server instances.
7. Add runtime tests for burst rejection, refill, independent players, multiple message classes, reconnect behavior, and proof that rejected packets cause no save/WAL write.
8. Select numerical capacities/refill rates only after observing normal UI request cadence and validating the event paths. No numeric threshold is approved by this audit.

## Finding
The message surface is now mapped sufficiently to design a rate limiter without blindly applying one threshold to every event. The absence of a shared gameplay limiter remains an availability/resource-exhaustion hardening issue; this review does not demonstrate reward duplication or an unauthenticated exploit.

## Follow-up: authentication cost and bucket ownership

- The current shared `onAuthenticatedMessage` wrapper verifies the room's stored session token on every gameplay packet, then calls player-state WAL recovery, then invokes the handler.
- `verifySession()` itself calls pending-player-WAL recovery and reads the sessions and accounts JSON files to validate the token/account relationship. Thus each inbound packet can trigger repeated recovery checks and disk-backed auth reads before reaching the gameplay handler. This is a separate ingress-cost amplification point and should be measured/considered in limiter placement.
- A safe limiter cannot simply replace session validation with an unchecked cache. Logout removes the session from the durable session store and closes the matching live client; any optimization must preserve prompt revocation semantics.
- Current topology enforces one client per room and one online room per player via `maxClients = 1`, `ONLINE_PLAYERS`, and `ONLINE_CLIENTS`. A per-player bucket stored at process scope would naturally survive reconnects in that process and cover the player's room, but it resets on process restart and is not shared across multiple server processes/instances.
- Suggested ordering for future implementation: cheap room/client ownership guard first; consume a per-player ingress budget before disk-backed session/WAL checks; preserve authoritative session revocation by ensuring logout closes the room and by defining a bounded revalidation policy. Do not implement this ordering until its stale-session and recovery race behavior has explicit tests.
- No code changed. Static source inspection only; no benchmark or runtime test performed.


## Follow-up: official client request cadence — 2026-11-15

- Static review of the official client action dispatcher and connection bootstrap found a 13-message startup request burst on every successful room connection. It loads catalog, expedition state, hunt group, clan, PvP, auction, market, dungeon, clan-war, and craft-queue data.
- The `clanList` response handler unconditionally sends `clanQuests` and `clanTerritories`, although both are already sent in the startup burst. This duplicates those two requests on every connection. It is a concrete low-risk optimization candidate, but no code change was made in this audit.
- The one-second client interval updates visible countdown text locally; it does not send a packet every second. PvP refresh is a one-shot request when the tracked cooldown/offer-expiry timestamp is reached, guarded by `pvpRefreshRequestedFor` until a response resets it.
- The client `guardedActions` set blocks repeated clicks for selected actions while an action is pending, but it is not a transport-level limiter: many read-shaped refresh actions are not guarded, the timeout releases a guard after 8 seconds, and any `notice` clears all pending action keys. Server enforcement remains mandatory.
- The startup burst is legitimate connection initialization and should be accounted for in any ingress budget (or deliberately grouped/coalesced) rather than treated as malicious behavior. Future policy should distinguish connection bootstrap, user-triggered refreshes, and mutations.
- Static source inspection only. No code changed, no benchmark or runtime test performed; no numerical thresholds selected.


## Follow-up: duplicated per-packet recovery scan — 2026-11-15

- Exact wrapper flow in `GameRoom.onAuthenticatedMessage` is: `verifySession(this.sessionToken)` -> local player/client identity checks -> `recoverPlayerStateBeforeMutation()` -> handler.
- `verifySession()` itself calls `sharedStateRuntime.recoverPendingPlayerState()` before checking token shape/hash, then reads `sessions.json` and `accounts.json` through `loadSessions()` and `loadAccounts()` to validate expiry and account binding.
- `recoverPlayerStateBeforeMutation()` immediately calls `sharedStateRuntime.recoverPendingPlayerState()` again. Therefore every authenticated gameplay packet currently performs two consecutive shared/legacy journal recovery scans, even when no journal is pending, plus the session/account reads. This is confirmed from source; exact filesystem syscall cost has not been benchmarked.
- Each recovery scan checks legacy auction/clan `hasPending`, then invokes their `recover()` methods and shared journal `recover()`; it is not just one in-memory boolean lookup. The wrapper's second scan is a concrete optimization candidate.
- Safe design direction: consolidate the wrapper's authentication/recovery work into one explicit ingress gate with one recovery result passed onward, while preserving authoritative session validation and recovery-before-mutation semantics. Do not simply remove `verifySession` or trust `ONLINE_SESSION_HASHES`: those maps only describe this process's current room ownership and do not independently prove durable session revocation state across server instances.
- A limiter can be considered before expensive durable checks only after defining the trusted per-room player identity, stale-room handling, logout revocation semantics, and multi-instance deployment assumptions. Cheap `ONLINE_CLIENTS` ownership check is useful but is not a replacement for authoritative token validation.
- No implementation or behavior change made. No syscall benchmark/runtime test; CI still pending at time of note.


## Follow-up: recovery result propagation and lifecycle paths — 2026-11-15

- Broader call-site scan confirms the duplicate scan is not limited to gameplay messages: `onJoin` calls `verifySession()` (which recovers pending player state) and then immediately calls `recoverPlayerStateBeforeMutation()` again.
- The `dungeonRun` path can perform a third recovery scan: the authenticated wrapper calls `verifySession()` and `recoverPlayerStateBeforeMutation()`, then `runExpeditionDungeon()` calls `recoverPlayerStateBeforeMutation()` again.
- Important behavior issue to preserve/resolve: `runExpeditionDungeon()` explicitly aborts with a retry notice when its own recovery call reports `playersRecovered=true`. But the wrapper has already consumed the pending recovery before entering the handler, so the dungeon-local check will normally see `false` even if the wrapper just recovered the player snapshot. This means the intended retry-on-player-recovery signal is not propagated to the dungeon handler. Treat this as a confirmed control-flow mismatch from source inspection; runtime impact has not yet been tested.
- Proposed refactor contract (not implemented): a single ingress authentication/recovery operation should return a structured result, e.g. `{ session, recovered, playersRecovered }`. Preserve the current authoritative session and account binding checks. Pass the recovery metadata to the message handler (or an explicit request context) so actions that require retry after player snapshot replay, such as dungeon entry, can make that decision without rescanning journals. Keep HTTP `verifySession` callers and logout semantics intact.
- `onJoin` should likewise consume one recovery result and use the recovered snapshot before loading the player. `onLeave`/`onDispose` and periodic/shutdown persistence paths remain separately audited lifecycle operations; do not globally remove their recovery checks as part of a message-wrapper refactor.
- Regression coverage required before implementation: (1) count recovery scans per authenticated packet and prove one ingress scan; (2) player-snapshot WAL replay propagates `playersRecovered=true` into dungeon guard and prevents that run; (3) auth-only/outbox-only recovery does not falsely trigger player-recovery retry; (4) valid session remains accepted after recovery; (5) logout revokes token and closes active room; (6) stale room/client is rejected; (7) onJoin loads recovered player snapshot; (8) ambiguous legacy journals fail closed; (9) no handler or persistence mutation runs after failed recovery.
- Existing runtime test infrastructure already includes real Colyseus clients and isolated data directories in `authLogoutRuntime.test.ts`, `duplicateSessionRuntime.test.ts`, and `authAccountRuntime.test.ts`; shared recovery behavior has unit coverage in `sharedStateRuntime.test.ts`. Extend these rather than inventing a weaker mock-only replacement.
- No code changed, no benchmark or runtime test performed. Latest docs commits require their own CI validation.


## Auth HTTP recovery call-site follow-up — 2026-11-15

- The authenticated HTTP handler performs an unconditional `recoverPendingPlayerState()` after parsing every `/auth/*` POST body.
- `/auth/check` and `/auth/logout` then call `verifySession()`, which performs another player-recovery scan before reading session/account files. This duplicates the preflight scan on both endpoints.
- `/auth/guest` can call `verifySession()` for legacy-session recovery, causing a second scan on that branch. Guest/session issuance and account registration also enter `sharedStateRuntime.transact()`, which performs its own recovery coordinator pass after the HTTP preflight. Thus the duplication is broader than gameplay WebSocket messages.
- The shared runtime's `transact()` then delegates to the shared store's own transaction wrapper, which performs its own internal recovery check; this is another call boundary to inspect before consolidating. Preserve WAL ordering and fail-closed behavior; do not simply delete preflights without proving transaction callbacks cannot observe stale state.
- Next safe design step: expose one explicit recovery context per request/ingress operation and make transaction APIs accept/consume that context only if their atomicity contract can be preserved. Otherwise keep recovery at transaction boundaries and remove only redundant outer scans after tests prove correctness.
- No code changed; source inspection only. No syscall benchmark or runtime test performed.


## Shared transaction coordinator duplication — 2026-11-15

- Confirmed `createSharedStateRuntime` calls `recoverPendingStateDetails()` before every runtime transaction (`transact`, `transactWithRecovery`, `commitAuction`, `commitClan`), then delegates to `options.shared.transact()`. `createSharedStateTransactionStore.transact()` unconditionally calls its own `recover()` before invoking the prepare callback. Therefore the shared WAL recovery check/replay entry point is invoked twice on these paths. The second call is still valuable for standalone/direct store callers, but is redundant inside this synchronous single-process coordinator after the first successful recovery.
- Existing `sharedStateRuntime.test.ts` explicitly asserts the duplicate sequence (`shared.recover` in coordinator, then `shared.transact` → `shared.recover`). This means a future optimization must update the expected call-count tests and add a direct-store regression proving standalone `shared.transact()` still recovers before snapshot preparation.
- Legacy auction/clan coordination also checks `hasPending()` and then calls `recover()` unconditionally. With no journal, both calls perform filesystem existence checks; with a pending journal, the journal is parsed/replayed only in `recover()`. The shared store similarly calls `hasPendingPlayers()` (which parses and validates a pending shared journal) before `recover()` parses it again. These checks are not equivalent to replay duplication: they support ambiguous-legacy-order rejection and `playersRecovered` classification. A safer API could return validated journal metadata from a single inspect/recover operation rather than dropping the checks.
- Safe refactor candidate: add a coordinator-only `transactAfterRecovery`/recovery-context path in the shared store, while retaining the existing self-recovering `transact()` for standalone callers. Keep the current synchronous single-process + exclusive data-directory lock assumption explicit; do not expose a bypass that can be called without successful coordinator recovery. Test direct-store recovery, coordinator one-pass behavior, pending shared/legacy replay, fail-closed corrupt/ambiguous journals, recovery metadata (`recovered` vs `playersRecovered`), and that callbacks never run after failed recovery.
- Source review also confirmed production auction/clan mutations route through the coordinator (`commitAuction`/`commitClan`); legacy `auctionTransactions.commit` and `clanTransactions.commit` remain recovery-only. No direct production bypass was identified in reviewed call sites.
- No code changed; no benchmark or runtime test performed. The finding is source-level and the current CI validates the unchanged implementation, not a proposed refactor.
