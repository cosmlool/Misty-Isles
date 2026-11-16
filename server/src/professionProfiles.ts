export const PROFESSIONS: Record<string, string[]> = {
  'Кот': ['Боевой маг', 'Ассасин'],
  'Собака': ['Рыцарь', 'Баффер'],
  'Птица': ['Лучник', 'Ассасин птицы'],
  'Грызун': ['Вампир', 'Добытчик'],
};

const PROFESSION_ALIASES: Record<string, string> = {
  'Воин': 'Рыцарь',
};

export type ProfessionArchetype =
  | 'mage' | 'assassin' | 'knight' | 'buffer' | 'archer' | 'vampire' | 'gatherer';

/** Converts historical profession labels to the current canonical display/storage label. */
export function normalizeProfession(value: unknown): string {
  const name = String(value ?? '').trim();
  return PROFESSION_ALIASES[name] || name;
}

export function isProfessionAllowedForRace(race: unknown, profession: unknown): boolean {
  const available = PROFESSIONS[String(race ?? '')] || [];
  return available.includes(normalizeProfession(profession));
}

/** Bird Assassin shares the existing Assassin combat archetype, but remains a distinct profession. */
export function getProfessionArchetype(value: unknown): ProfessionArchetype | undefined {
  const profession = normalizeProfession(value);
  if (profession === 'Боевой маг') return 'mage';
  if (profession === 'Ассасин' || profession === 'Ассасин птицы') return 'assassin';
  if (profession === 'Рыцарь') return 'knight';
  if (profession === 'Баффер') return 'buffer';
  if (profession === 'Лучник') return 'archer';
  if (profession === 'Вампир') return 'vampire';
  if (profession === 'Добытчик') return 'gatherer';
  return undefined;
}

export function getProfessionWeaponStyle(value: unknown): 'dual-daggers' | 'single-dagger' | undefined {
  const profession = normalizeProfession(value);
  if (profession === 'Ассасин') return 'dual-daggers';
  if (profession === 'Ассасин птицы') return 'single-dagger';
  return undefined;
}
