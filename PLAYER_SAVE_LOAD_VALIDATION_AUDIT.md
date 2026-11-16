# Player-save loading and migration integrity audit — 2026-11-15

## Scope and method

Static source review of `server/src/playerSaves.ts`, `PlayerSchema.ts`, `playerJson.ts`, `jsonPersistence.ts`, `dungeonRunState.ts`, and the relevant startup/auth/player-join paths in `server/src/index.ts`, plus focused unit tests. No production code, save data, or tests changed; no local tests executed.

## Findings

### Player snapshot envelope

- `createPlayerSaveStore.loadPlayers()` rejects unreadable files, malformed JSON, non-object roots, arrays as the root, and null/array/non-object player entries. It does not silently replace corrupt data with an empty map.
- The envelope check does not validate player IDs, embedded `player.id` consistency, field schemas, nested JSON strings, string lengths, array sizes, or gameplay ranges. A structurally valid object can therefore contain semantically invalid player state.
- On room join, the server selects the save by the authenticated session's player ID and then overwrites `player.id` with that authenticated ID. This prevents the saved embedded ID from choosing the online identity in this path; it does not validate the rest of the saved identity/profile fields.

### Applying saved Player fields

- `applyPlayerSave()` copies only keys already present on the `Player` instance and uses shallow type matching: finite number to number, string to string, boolean to boolean, array to array, and plain object-shaped values to object-shaped fields. It ignores unknown keys, undefined, wrong primitive types, and non-finite numeric values.
- This is useful type filtering, not a domain schema. Finite negative values and extremely large numbers are accepted for numeric fields such as level, health, gold, stats, cooldown timestamps, and counters. There is no safe-integer or per-field range validation here.
- `applySaved()` subsequently floors level and clamps it to a minimum of 1, then recomputes `experienceToNext`. There is no maximum level bound. A very large but finite saved level can make `xpNeed(level)` overflow to `Infinity`; the finite-number filter does not prevent that downstream derived value.
- Arrays are assigned wholesale with no item-type/count validation. String-backed JSON fields (inventory, quests, equipment, collections, etc.) accept any string, including malformed or oversized JSON. Their later `readPlayerArray` / `readPlayerObject` calls reject malformed JSON and wrong root types, but only when that field is consumed; this can turn a successful join into a later handler failure.
- Object/array copying is shallow. No general normalization or migration pass validates all nested player state before the character becomes online.

### Normalization and migrations

- The reviewed join-time normalizers are narrow: profession normalization and legacy city-name/reputation/visited-collection key normalization. They are not a versioned migration framework and do not comprehensively validate player fields.
- City normalization mutates the in-memory Player and serializes the updated reputation/collections strings. The reviewed path does not write a migration snapshot immediately; normal player persistence later commits the current Player state through the shared WAL.
- No general per-player save schema version or ordered migration registry was found in the reviewed paths. Do not treat the existing normalizers as a complete migration guarantee.

### JSON-backed stores and auth records

- `readJsonFile()` distinguishes a missing file (default allowed) from unreadable or malformed data (fail closed), and applies the caller's supplied root/entry predicate.
- Accounts, sessions, and guest credentials have useful basic shape checks, but the reviewed predicates do not enforce unique account/player/token identifiers, digest hex length/format, bounded strings, safe-integer timestamps, or full cross-file referential consistency at load time. Session verification later checks expiry and account binding, and guest proof verification compares a digest, but these are use-time checks rather than a comprehensive startup schema.
- `playerJson` helpers validate JSON syntax and root array/object shape only; nested element schemas and size limits are not enforced there.

### Durable dungeon snapshot validation

- `validateDungeonRunStore()` is materially stricter than the general player-save loader: it checks run version/key, unique 1–3 participant roster, leader membership, status enums, timestamps, round-plan alignment, finite/nonnegative damage, participant health/status, boss bounds, and terminal-result consistency. Startup validates this store after shared-WAL recovery and rejects invalid snapshots.
- Remaining schema-hardening opportunities include safe-integer/range limits for counters/timestamps/damage, maximum string lengths, explicit rejection of unknown/extra fields if desired, and explicit key validation. These are hardening opportunities; no exploit or production data-loss defect was established by this review.
- The shared WAL validates configured target names and JSON serializability, not each target's domain schema. Domain validation therefore remains the responsibility of each store's loader/startup path.

## Risk assessment

Confirmed hardening gaps, not demonstrated remote exploits:
1. Semantically invalid but type-compatible player values can pass load/apply and influence gameplay or derived values.
2. Malformed string-backed nested JSON can pass player snapshot loading and fail later when a feature reads that field.
3. No comprehensive versioned player migration/schema validation boundary exists.
4. Auth record validators are structural rather than full uniqueness/format/cross-reference validators.

## Recommended safe sequence

1. Inventory actual field invariants and legacy-compatible values before adding bounds; do not guess caps or clamp legitimate player progress.
2. Introduce a pure, versioned player-save validation/normalization boundary that reports field-specific failures and preserves unknown legacy data until compatibility is proven.
3. Decide whether invalid individual fields should fail the entire player load or be quarantined; never silently reset inventory, currency, progression, or identity.
4. Add fixtures for negative/huge finite values, malformed JSON strings, oversized arrays/strings, unknown enums, duplicate IDs, mismatched embedded IDs, and legacy city/profession values.
5. Add idempotence tests for migrations and prove that loading without a migration does not rewrite saves. Commit any production migration only after compatibility review and explicit approval.

## Validation status

Source review only. No production code, tests, or save files changed. No local tests run. Existing CI validates the unchanged implementation, not a proposed schema/migration refactor.


## Player field inventory and compatibility map — 2026-11-15

### Persisted Player shape

The current Colyseus `Player` declares these fields in `server/src/PlayerSchema.ts`; several server-only properties are ordinary class properties but are also eligible for `applyPlayerSave` because the loader matches existing instance keys.

| Domain | Fields | Validation / compatibility notes |
|---|---|---|
| Identity & location | `id`, `name`, `race`, `profession`, `city`, `zone`, `clan`, `craftingSpecialty` | Strings only at apply time. No general allowed-value, length, cross-field, or canonical ID check at player-load boundary. Race set in current content: Кот, Собака, Птица, Грызун. Profession map: Кот → Боевой маг/Ассасин; Собака → Рыцарь/Баффер; Птица → Лучник/Ассасин птицы; Грызун → Вампир/Добытчик. Legacy alias Воин → Рыцарь. Existing normalizer does not enforce race/profession pairing. |
| Position & timing | `zone`, `x`, `y`, `lastSeenAt`, `lastHuntAt`, `lastPvpAt`, `lastFountainAt`, `lastDailyAt`, `lastMineAt`, `lastWorkAt`, `buffUntil`, `returnRewardAt` | Numeric fields accept any finite number, including negative and unsafe integers. No common timestamp/coordinate validation at load. `lastDailyAt`, `lastMineAt`, `lastWorkAt`, `x`, `y` are ordinary properties, not synchronized Schema fields. |
| Progression & stats | `level`, `experience`, `experienceToNext`, `statPoints`, `strength`, `defense`, `vitality`, `dexterity`, `intelligence`, `luck`, `stamina`, `accuracy`, `health`, `maxHealth` | Finite number only. `applySaved` floors level and clamps to minimum 1, then recalculates XP threshold; no maximum level. No load-time nonnegative/stat-point/health<=maxHealth invariant. Avoid inventing caps without catalog/progression history. |
| Currency & counters | `gold`, `crystals`, `gems`, `goldSpent`, `goldEarned`, `itemsCrafted`, `itemsSold`, `pvpWins`, `pvpLosses`, `mobsKilled`, `rareMonstersKilled`, `bossesKilled`, `battles`, `victories`, `mining`, `fishing`, `crafting` | Finite number only; negative/fractional/unsafe integer values pass the generic loader. Need determine legitimate fractional fields and historical corrections before adding integer/nonnegative constraints. |
| Buff state | `buff`, `buffValue`, `buffSecondaryEffect`, `buffSecondaryValue`, `buffUntil`, `returnBonusAvailable` | Primitive types checked, but effect enums, paired value/effect consistency, magnitude, and timestamps are not schema-validated. Runtime buff reader caps effective values to 1 and falls back for unknown/invalid values; this is not a persisted-schema migration. |
| Serialized collections | `inventory`, `equipment`, `equipmentEnhancements`, `buildings`, `quests`, `cityReputation`, `collections`, `achievements`, `daily`, `mail`, `craftQueue`, `guildSkills`, `auctionHistory` | Stored as strings; only string type is checked during player apply. JSON parse/root checks happen lazily via `readPlayerArray` / `readPlayerObject`; nested members and size are not validated there. Gender is stored at `collections.characterGender` and accepts only `male`/ `female` when read by the dedicated helper. |
| Other schema metadata | `lastPvpResult`, `buffSecondaryEffect`, `returnBonusAvailable` | No global enum/range validation at load. |

### Compatibility behavior actually present

- Profession: only the exact historical label `Воин` maps to `Рыцарь`; other values are preserved as-is. The mapping is not race-aware.
- City: five legacy names map to current names: Вольный перекрёсток → Каменный порт; Гавань семи ветров → Изумрудная долина; Серебряный бастион → Золотые дюны; Кристальный двор → Серебряные руины; Пепельная цитадель → Северная корона.
- City reputation migration moves an old key to the new key using the larger numeric value, then deletes the old key. Visited-city collection flags are copied to the new key and old keys deleted. This mutates the in-memory player during join; a later normal WAL save persists it.
- Character gender is optional in old saves: missing/invalid values read as `null`; do not assign a default to existing characters without explicit compatibility decision.
- Unknown player-save keys are ignored by `applyPlayerSave`; known keys with wrong primitive types are ignored. Object/array nested content is not deeply merged or validated because serialized fields are strings in the current schema.

### Auth record schemas (current loader predicates)

- Accounts: array of objects with string `username`, `usernameKey`, `playerId`, `salt`, `passwordHash` and finite `createdAt`.
- Sessions: array of objects with string `tokenHash`, `playerId`, `accountKey` null-or-string and finite `expiresAt`.
- Guest credentials: array of objects with string `playerId`, `tokenHash` and finite `createdAt`.
- These predicates do not establish uniqueness, bounded lengths, digest encoding/length, safe-integer timestamps, or full account/session/guest cross-reference consistency. Some relationships are checked at use time; do not conflate that with load-time validation.

### Migration safety decisions required before implementation

1. Build a field-by-field legacy corpus from real shipped/test saves and commit history; establish units, integer-vs-fractional semantics, timestamp epochs, coordinate conventions, and actual enum variants.
2. Define invariants separately from normalization. A normalizer must not invent a new value where legacy intent is ambiguous.
3. Validate the race/profession pair without silently changing either field. Quarantine/report ambiguous records rather than assigning a different class.
4. Keep unknown JSON keys/data recoverable until a compatibility policy exists; avoid destructive round-trip serialization that drops future fields.
5. Treat identity, inventory, currency, progression, gender, and achievement records as preservation-critical. A failed migration must leave original bytes and backups untouched.
6. Require migration idempotence, before/after fixtures, WAL atomicity, rollback/fail-closed behavior, and tests for loading old versions twice.

No schema caps, enum coercions, or production migrations are approved by this audit. No production code/tests/data changed.


## Repository-history and legacy-data availability check — 2026-11-15

### What the repository can and cannot prove

- The current Git history for the inspected core files (server/src/PlayerSchema.ts, server/data/forgotten_lands.json, and server/data/equipment_catalog.json) contains only the initial repository import commit dated 2026-11-08. It does not provide a sequence of prior schema/catalog revisions from which to reconstruct all historical enum values.
- The tracked tree contains static game catalogs (city_npcs.json, equipment_catalog.json, forgotten_lands.json) but no representative player-save fixtures.
- .gitignore explicitly excludes runtime persistence, including .local-data/, server/data/players.json, its backups, auction/clan/dungeon state, accounts, sessions, guest credentials, and transaction files. This is appropriate for privacy and security, but means the repository cannot serve as a real-player legacy-save corpus.
- Stage 28 changelog records that the five city-name migrations were introduced in the working copy on 2026-11-08 and describes preservation of reputation and first-visit flags. It is a useful change record, not proof of every city string ever used in deployed saves.
- The current profession module has one explicit historical alias (Воин → Рыцарь). The available commit history does not establish whether there were other aliases in earlier untracked working copies or deployed saves.

### Compatibility evidence classification

| Evidence | What is established | What remains unknown |
|---|---|---|
| Current player schema/source | Current field names and current runtime normalization behavior | Older deployed schema versions and field semantics |
| Git history | Initial import baseline for inspected files | Pre-import revisions and deleted/untracked history |
| Static catalogs | Current catalog records and IDs | All historical catalog IDs/names ever granted to players |
| Changelog | Recorded Stage 28 city rename and compatibility intent | Actual distribution and frequency of legacy values |
| Runtime save files | Explicitly ignored by Git | Actual legacy player records; they must be inspected through a controlled, read-only export/fixture process |

### Required next evidence before migration design

1. Obtain a user-approved, privacy-scrubbed, read-only export of representative players.json snapshots and backups from each known deployed version. Do not upload credentials, session tokens, guest proofs, or personal account data.
2. Build fixtures from copies, preserving original bytes and recording source version/date; redact names and account identifiers while preserving structural and semantic values.
3. Inventory item IDs, profession/race/city values, achievement keys, quest keys, timestamps, coordinates, and nested serialized objects across the corpus.
4. Compare observed values against current catalogs and source-level aliases. Distinguish confirmed legacy values from typos, corrupted records, and unknown future values.
5. Only then specify versioned migration steps, preserve/quarantine behavior, rollback and idempotence tests. Never infer that absence from Git means a value was never used.

No player data was read or changed in this stage. No migration or production code was added.


## Equipment catalog identity audit — 2026-11-15

- Parsed the tracked current equipment catalog: 387 entries, all with non-empty string IDs and names; no duplicate IDs or duplicate names in this file.
- Current kinds: 56 weapons, 320 armor entries, 11 amulets. No unknown/missing kind values were found in this snapshot.
- The server loads this catalog as the authoritative source for new equipment, marks the pre-existing in-code weapon/armor/amulet entries as legacy, then appends the new catalog and expedition drop items to the shared runtime item list.
- Source comment explicitly states legacy IDs remain available for existing saves, auctions, and recipes. This is a compatibility invariant: do not repurpose or rename an existing item ID merely because its display name/catalog entry changes.
- The current equipment catalog is a single static snapshot; Git history for this file contains only the initial import. There is no complete historical catalog-ID ledger or player-save fixture corpus in the repository.
- Zone signature drops in the current Forgotten Lands data are display-name strings, while gatekeeper references are IDs. These namespaces must not be conflated; any future migration must resolve them against the appropriate drop/bestiary source.
- This is a current-snapshot structural check, not proof that every historical item ID remains present or that all runtime references resolve. A follow-up should build a cross-reference report for legacy in-code items, recipes, auctions, player inventory/equipment, expedition drops, and bestiary/gatekeeper IDs using sanitized fixtures.
- No catalog IDs, prices, stats, items, saves, or production code were changed.


## Cross-catalog identity and reference audit — 2026-11-15

### Current static snapshot results

| Dataset / reference family | Result |
|---|---:|
| Original in-code item definitions | 149 unique IDs |
| New equipment catalog | 387 unique IDs |
| Forgotten Lands drop items | 125 unique IDs |
| Combined current runtime item IDs | 661 unique IDs; no overlap or duplicates across the three sources |
| Recipes declared directly in index.ts | 11 |
| Forgotten Lands monsters / zones | 100 / 10 |
| Monster drop references | All resolve to dropItems; no duplicate drop IDs per monster; all chances are finite and within 0..1 |
| Drop sourceMonster references | All resolve to monster IDs |
| Monster zoneId references | All resolve to zone IDs |
| Dungeon bossId/resource references | All four dungeons resolve |
| Zone gatekeeperId references | All resolve to monster IDs |
| Armor sets in new catalog | 64 sets; each has exactly five distinct required slots, consistent profession and setBonus |
| Legacy set references | All item IDs resolve in the current runtime item union |

All 11 static recipe outputs and all 27 material references resolve to the current runtime item ID union. The 40 legendary armor pieces are also used to generate additional recipes at runtime; their required special materials FLDROP-10-10-A and FLDROP-10-10-B are present in the drop catalog.

### Compatibility behavior confirmed in source

- The server item list is assembled from the original in-code items, the new equipment catalog, and Forgotten Lands drop items. The auction's valid-item set is built from this combined runtime list, so legacy item IDs remain eligible for existing auction lots.
- Recipes whose output item is marked legacy are removed from the visible recipe list, but a queued job stores its output ID and a copy of its materials when startCraftJob() is called. Claiming a queued job uses the stored output ID and does not require the recipe to remain visible.
- A queued job whose stored materials are absent can use recipe fallback materials during cancellation. If its recipe was retired and the job has no stored materials, cancellation fails closed and retains the job rather than guessing a refund.
- The repository contains no real legacy craftQueue snapshots, so it cannot establish whether every deployed old job has the newer stored materials field.

### Confirmed hardening gap — craft output identity

The craftClaim handler looks up job.output in the current item list only to detect unique-amulet conflicts. If the lookup returns no item, it still calls claimCraftJob(), whose current behavior appends the raw job.output string to inventory. Thus a malformed or obsolete queued job can create an inventory entry that does not resolve to a known item. This is a data-integrity issue, not evidence of an exploit through ordinary client input. Before changing it, preserve the job on rejection and add regression coverage for known legacy outputs, unknown output IDs, unique amulets, and already-queued jobs whose recipe has been retired. Do not silently delete or rewrite old queue entries.

No catalog IDs, recipes, drops, prices, stats, saves, or production code were changed in this stage. This was a static source/data audit; no local tests were run.


### Craft output identity gap — remediation on 2026-11-15

- Hardened claimCraftJob() to require a caller-supplied read-only set of valid runtime item IDs and reject a queued output that is not present. Rejection leaves both inventory and queue unchanged; the job remains available for manual review.
- The live craftClaim handler supplies IDs from the complete runtime ITEMS list (original legacy items + new equipment + expedition drops), so known legacy outputs and queued jobs whose recipe is no longer visible remain claimable when their output ID is still registered.
- Added regression coverage proving an unknown output from a retired recipe cannot be granted and the original job is retained. Existing claim/reconnect/unique-amulet tests now supply the valid item set.
- This does not rewrite old queue entries or refund materials. If an old output ID is genuinely absent from the current runtime catalog, the job is retained rather than silently discarded or converted.
- GitHub Actions validation is required for this production hardening change; no local tests were run.


## Legacy city migration loss-prevention follow-up — 2026-11-16

- Rechecked the actual join-time normalizer. The prior reputation migration used `Number(value || 0)` followed by `Math.max`; malformed strings or negative values could be coerced into a new number (including `NaN`, which JSON serialization turns into `null`) and the legacy key was then deleted. The visited-city migration also treated any truthy value (including the string `"false"`) as a confirmed visit and removed the original key.
- Extracted the two narrow transforms into `server/src/playerSaveMigrations.ts`. Reputation aliases now move only when the legacy value and any existing current value are finite, nonnegative numbers. Invalid, negative, or ambiguous values are retained under their original keys; the transform does not mutate its input. Visited-city aliases move only when the legacy flag is exactly boolean `true`; malformed flags remain untouched.
- Wired the loss-preserving transforms into the existing join-time normalizer and added unit tests for numeric merge, malformed/negative preservation, explicit boolean flags, and input immutability. Existing city aliases and normal valid migration behavior remain unchanged.
- No full player schema migration was attempted: runtime player saves are intentionally gitignored, and inspected core files have only the initial import in repository history. There is no representative sanitized deployed-save corpus to justify broad enum/range coercion, schema caps, or automatic repair. Existing characters' identity, inventory, currency, progression, gender, and achievements remain untouched except for the already-supported city/profession aliases.

## WAL finalization durability error handling — 2026-11-16

- Found a real error-reporting gap after journal unlink: if the final data-directory fsync failed, `recover()` returned `false` because the journal was no longer visible, and `transact()` swallowed the original sync error and returned success despite uncertain journal-deletion durability.
- Changed the transaction path to track journal removal and successful final directory sync separately. If the journal has been removed but its final directory sync fails, the transaction now throws an explicit durability-uncertain error instead of reporting success. Target files remain applied; callers must not assume the operation was rolled back.
- Added a regression test simulating failure specifically at the final directory sync. Also corrected an over-escaped backup filename regex in the retry-amplification test, which caused the previous CI run to report zero backups despite the backup file being present.
- CI run `43780783664` on the PR merge ref containing HEAD `c7ae22b7d54a48c3b171f54d833b25e55a3ee6ff` failed the server suite: 459/461 passed. The two failures were (1) the over-escaped backup-test regex and (2) an intermittent clan-war runtime timeout waiting for a nonmember rejection. The latter is recorded for verification on the new HEAD; no gameplay rule was changed to mask it.
