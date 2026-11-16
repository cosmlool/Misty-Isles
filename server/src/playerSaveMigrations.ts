/**
 * Narrow, loss-preserving transforms for the explicitly supported legacy city aliases.
 * Unknown or malformed values are retained for inspection instead of being coerced.
 */
export function migrateLegacyCityReputation(
  reputation: Record<string, unknown>,
  aliases: Record<string, string>,
): Record<string, unknown> {
  const migrated = { ...reputation };
  for (const [legacyCity, currentCity] of Object.entries(aliases)) {
    if (!Object.prototype.hasOwnProperty.call(migrated, legacyCity)) continue;
    const legacyValue = migrated[legacyCity];
    const currentValue = migrated[currentCity];
    if (typeof legacyValue !== 'number' || !Number.isFinite(legacyValue) || legacyValue < 0) continue;
    if (currentValue !== undefined &&
      (typeof currentValue !== 'number' || !Number.isFinite(currentValue) || currentValue < 0)) continue;
    migrated[currentCity] = Math.max(currentValue === undefined ? 0 : currentValue, legacyValue);
    delete migrated[legacyCity];
  }
  return migrated;
}

export function migrateLegacyVisitedCities(
  collections: Record<string, unknown>,
  aliases: Record<string, string>,
): Record<string, unknown> {
  const migrated = { ...collections };
  for (const [legacyCity, currentCity] of Object.entries(aliases)) {
    const legacyKey = `visited_${legacyCity}`;
    const currentKey = `visited_${currentCity}`;
    if (migrated[legacyKey] !== true) continue;
    const currentValue = migrated[currentKey];
    if (currentValue !== undefined && typeof currentValue !== 'boolean') continue;
    migrated[currentKey] = true;
    delete migrated[legacyKey];
  }
  return migrated;
}
