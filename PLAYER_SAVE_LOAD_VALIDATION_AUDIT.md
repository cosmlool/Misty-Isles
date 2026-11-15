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
