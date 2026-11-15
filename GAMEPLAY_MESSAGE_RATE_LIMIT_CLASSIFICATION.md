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
