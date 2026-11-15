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
