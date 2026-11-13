export const CHARACTER_GENDERS = ['male', 'female'] as const;
export type CharacterGender = (typeof CHARACTER_GENDERS)[number];

export function isCharacterGender(value: unknown): value is CharacterGender {
  return value === 'male' || value === 'female';
}

export function readCharacterGender(collections: unknown): CharacterGender | null {
  let value: unknown = collections;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const gender = (value as Record<string, unknown>).characterGender;
  return isCharacterGender(gender) ? gender : null;
}
