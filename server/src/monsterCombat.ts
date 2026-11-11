export type MonsterPassiveEffect = {
  physicalResistance?: number;
  magicResistance?: number;
  allResistance?: number;
  allResistanceAboveHpRatio?: { threshold: number; resistance: number };
  professionResistance?: Record<string, number>;
  defenseMultiplier?: number;
  attackMultiplier?: number;
  attackWhenAllies?: number;
  defenseWhenAllies?: number;
  firstAttackMultiplier?: number;
  attackBelowHpRatio?: { threshold: number; multiplier: number };
  attackAboveHpRatio?: { threshold: number; multiplier: number };
  attackAfterRound?: { round: number; multiplier: number };
  attackAfterCritical?: number;
  defenseBelowHpRatio?: { threshold: number; multiplier: number };
  attackVsProfession?: { profession: string; multiplier: number };
  attackVsWeakened?: number;
  damageVsFastTargets?: number;
  damageVsSlowTargets?: number;
  damageVsArmoredTargets?: number;
  damageVsLowDefenseTargets?: number;
  damageVsLowHpTargets?: { threshold: number; multiplier: number };
  damageVsProfession?: { profession: string; multiplier: number };
  critDamage?: number;
  critDamageTaken?: number;
  evasion?: number;
  lifesteal?: number;
  healEveryRounds?: { rounds: number; maxHpRatio: number };
  healReduction?: number;
  poisonOnHit?: boolean;
  enemySpeedReductionFirstRound?: number;
  enemyAttackReduction?: number;
  enemyDefenseReduction?: number;
  enemyBuffSuppression?: number;
  ignoresBlindAccuracyPenalty?: boolean;
};

const passiveEffects: Record<string, MonsterPassiveEffect> = {
  'Лучник наносит на 15% меньше урона': { professionResistance: { 'Лучник': 0.15 } },
  'Убийца наносит на 15% меньше урона': { professionResistance: { 'Ассасин': 0.15 } },
  'На 20% меньше физического урона': { physicalResistance: 0.20 },
  'Защита +15%': { defenseMultiplier: 1.15 },
  'Атака +10% при союзниках': { attackWhenAllies: 0.10 },
  'Уклонение +15%': { evasion: 0.15 },
  'Восстанавливает 5% нанесённого урона': { lifesteal: 0.05 },
  'Первая атака +20%': { firstAttackMultiplier: 1.20 },
  'Физический урон −25%': { physicalResistance: 0.25 },
  'Весь урон −20%; ниже 50% HP атака +20%': { allResistance: 0.20, attackBelowHpRatio: { threshold: 0.50, multiplier: 1.20 } },
  'Физический урон −20%': { physicalResistance: 0.20 },
  'Атака +15% против ослабленной цели': { attackVsWeakened: 0.15 },
  'Урон лучника −15%': { professionResistance: { 'Лучник': 0.15 } },
  'Лечение противника −10%': { healReduction: 0.10 },
  'Урон лучника −20%': { professionResistance: { 'Лучник': 0.20 } },
  'Восстанавливает 8% HP каждый второй раунд': { healEveryRounds: { rounds: 2, maxHpRatio: 0.08 } },
  'Критический урон +10%': { critDamage: 0.10 },
  'Урон +20% по быстрым целям': { damageVsFastTargets: 0.20 },
  'Урон лучника −25%': { professionResistance: { 'Лучник': 0.25 } },
  'Атака +15% при союзниках': { attackWhenAllies: 0.15 },
  'Урон +20% по медленным целям': { damageVsSlowTargets: 0.20 },
  'Физический урон −15%': { physicalResistance: 0.15 },
  'Атака +10% при HP выше 75%': { attackAboveHpRatio: { threshold: 0.75, multiplier: 1.10 } },
  'Магический урон −15%': { magicResistance: 0.15 },
  'После критического удара атака +15%': { attackAfterCritical: 0.15 },
  'Атака и защита +15% при союзниках': { attackWhenAllies: 0.15, defenseWhenAllies: 0.15 },
  'Атака +20% ниже 50% HP': { attackBelowHpRatio: { threshold: 0.50, multiplier: 1.20 } },
  'Магический урон −20%': { magicResistance: 0.20 },
  'Не теряет точность от ослепления': { ignoresBlindAccuracyPenalty: true },
  'Магический урон −25%': { magicResistance: 0.25 },
  'Первая атака +25%': { firstAttackMultiplier: 1.25 },
  'Весь урон −20%': { allResistance: 0.20 },
  'Атака +15% против мага': { attackVsProfession: { profession: 'Боевой маг', multiplier: 1.15 } },
  'Атака накладывает яд': { poisonOnHit: true },
  'Критический урон −20%': { critDamageTaken: 0.20 },
  'Урон +20% по защищённым целям': { damageVsArmoredTargets: 0.20 },
  'Физический урон −30%': { physicalResistance: 0.30 },
  'Атака +15% ниже 50% HP': { attackBelowHpRatio: { threshold: 0.50, multiplier: 1.15 } },
  'Атака +15% после первого раунда': { attackAfterRound: { round: 1, multiplier: 1.15 } },
  'Атака +25% ниже 40% HP': { attackBelowHpRatio: { threshold: 0.40, multiplier: 1.25 } },
  'Критический урон +15%': { critDamage: 0.15 },
  'Атака +20% против ослабленных': { attackVsWeakened: 0.20 },
  'Восстанавливает 10% HP каждый третий раунд; урон лучника −20%': { healEveryRounds: { rounds: 3, maxHpRatio: 0.10 }, professionResistance: { 'Лучник': 0.20 } },
  'Получает на 20% больше магического урона': { magicResistance: -0.20 },
  'Снижает скорость противника на 20% в первом раунде': { enemySpeedReductionFirstRound: 0.20 },
  'Весь урон −20% пока HP выше 50%': { allResistanceAboveHpRatio: { threshold: 0.50, resistance: 0.20 } },
  'Урон +20% по целям с низкой защитой': { damageVsLowDefenseTargets: 0.20 },
  'Весь урон −25%': { allResistance: 0.25 },
  'Восстанавливает 7% нанесённого урона': { lifesteal: 0.07 },
  'Не теряет точность при ослеплении': { ignoresBlindAccuracyPenalty: true },
  'Критический урон +20%': { critDamage: 0.20 },
  'Снижает защиту цели на 10%': { enemyDefenseReduction: 0.10 },
  'Атака снижает DEF цели на 10%': { enemyDefenseReduction: 0.10 },
  'Восстанавливает 10% нанесённого урона': { lifesteal: 0.10 },
  'Атака противника −10%': { enemyAttackReduction: 0.10 },
  'Восстанавливает 8% нанесённого урона': { lifesteal: 0.08 },
  'Критический урон −25%': { critDamageTaken: 0.25 },
  'Урон +25% по целям ниже 30% HP': { damageVsLowHpTargets: { threshold: 0.30, multiplier: 1.25 } },
  'Атака и защита +15%; физический урон −25%': { attackMultiplier: 1.15, defenseMultiplier: 1.15, physicalResistance: 0.25 },
  'Снижает силу одного усиления противника на 10%': { enemyBuffSuppression: 0.10 },
  'Урон по лучникам +20%': { damageVsProfession: { profession: 'Лучник', multiplier: 1.20 } },
  'Защита +25% ниже 25% HP': { defenseBelowHpRatio: { threshold: 0.25, multiplier: 1.25 } },
  'Физический урон −20%; магический урон −15%; ниже 30% HP атака +30%': { physicalResistance: 0.20, magicResistance: 0.15, attackBelowHpRatio: { threshold: 0.30, multiplier: 1.30 } }
};

export function resolveMonsterPassive(description: string): MonsterPassiveEffect | undefined {
  return passiveEffects[description];
}

function normalizePassiveProfession(profession: string): string {
  const aliases: Record<string, string> = { 'Маг': 'Боевой маг', 'Убийца': 'Ассасин' };
  return aliases[profession] || profession;
}

function finitePassiveValue(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? value as number : fallback;
}

/**
 * Static compatibility helpers for the legacy aggregate expedition/dungeon
 * formulas. Dynamic HP thresholds and per-round status effects stay in the
 * shared resolveMonsterBattle engine.
 */
export function resolveLegacyMonsterResistance(effect: MonsterPassiveEffect | undefined, profession: string): number {
  const normalizedProfession = normalizePassiveProfession(profession);
  // The legacy path has no explicit damageType mapping: preserve its existing
  // rule that Battle Mage damage is magical and other professions are physical.
  const typeResistance = normalizedProfession === 'Боевой маг'
    ? finitePassiveValue(effect?.magicResistance)
    : finitePassiveValue(effect?.physicalResistance);
  const professionResistance = Object.entries(effect?.professionResistance || {})
    .find(([name]) => normalizePassiveProfession(name) === normalizedProfession)?.[1] || 0;
  return Number(Math.min(0.85, Math.max(-0.75,
    finitePassiveValue(effect?.allResistance) + typeResistance + finitePassiveValue(professionResistance),
  )).toFixed(10));
}

/** Expected hit multiplier for the legacy aggregate combat formulas, matching the typed engine's evasion rules. */
export function resolveLegacyMonsterHitMultiplier(effect: MonsterPassiveEffect | undefined, accuracyBonus = 0): number {
  const evasion = Math.min(0.75, Math.max(0, finitePassiveValue(effect?.evasion)));
  const accuracy = Math.min(0.75, Math.max(0, finitePassiveValue(accuracyBonus)));
  return Number((1 - Math.min(0.75, Math.max(0, evasion - accuracy))).toFixed(10));
}

/** Expected monster hit rate after player evasion, matching the typed engine's hit and dodge checks. */
export function resolveLegacyPlayerHitMultiplier(evasionBonus = 0, monsterAccuracy = 100): number {
  const accuracy = Math.min(1, Math.max(0.05, finitePassiveValue(monsterAccuracy, 100) / 100));
  const evasion = Math.min(0.75, Math.max(0, finitePassiveValue(evasionBonus)));
  return Number((accuracy * (1 - evasion)).toFixed(10));
}

export function resolveLegacyMonsterAttackMultiplier(effect: MonsterPassiveEffect | undefined, monsterAllies = 0): number {
  const allyBonus = monsterAllies > 0 ? finitePassiveValue(effect?.attackWhenAllies) : 0;
  return Number(Math.max(0, finitePassiveValue(effect?.attackMultiplier, 1) * (1 + allyBonus)).toFixed(10));
}

export function resolveLegacyMonsterDefenseMultiplier(effect: MonsterPassiveEffect | undefined, monsterAllies = 0): number {
  const allyBonus = monsterAllies > 0 ? finitePassiveValue(effect?.defenseWhenAllies) : 0;
  return Number(Math.max(0, finitePassiveValue(effect?.defenseMultiplier, 1) * (1 + allyBonus)).toFixed(10));
}

export function resolveLegacyMonsterProfessionDamageMultiplier(effect: MonsterPassiveEffect | undefined, profession: string): number {
  const normalizedProfession = normalizePassiveProfession(profession);
  const attackBonus = effect?.attackVsProfession &&
    normalizePassiveProfession(effect.attackVsProfession.profession) === normalizedProfession
    ? finitePassiveValue(effect.attackVsProfession.multiplier, 1) : 1;
  const damageBonus = effect?.damageVsProfession &&
    normalizePassiveProfession(effect.damageVsProfession.profession) === normalizedProfession
    ? finitePassiveValue(effect.damageVsProfession.multiplier, 1) : 1;
  return Number(Math.max(0, attackBonus * damageBonus).toFixed(10));
}

export function getMonsterPassiveDescriptions(): string[] {
  return Object.keys(passiveEffects);
}

export type MonsterWeakness =
  | { kind: 'profession'; profession: string; bonus: number }
  | { kind: 'damageType'; damageType: 'fire'; bonus: number };

export function parseMonsterWeakness(value: string): MonsterWeakness | undefined {
  const match = /^(.+?)\s*\+(\d+)%$/.exec(value.trim());
  if (!match) return undefined;
  const target = match[1].trim();
  const bonus = Number(match[2]) / 100;
  if (!Number.isFinite(bonus) || bonus <= 0) return undefined;
  if (target === 'Огненный урон') return { kind: 'damageType', damageType: 'fire', bonus };
  if (['Маг', 'Лучник', 'Воин', 'Ассасин'].includes(target)) {
    return { kind: 'profession', profession: target, bonus };
  }
  return undefined;
}

/** Applies explicit profession weaknesses in the legacy runtime; player damage-type mapping is not available here. */
export function resolveLegacyMonsterWeaknessMultiplier(weakness: MonsterWeakness | undefined, profession: string): number {
  if (!weakness || weakness.kind !== 'profession') return 1;
  return normalizePassiveProfession(weakness.profession) === normalizePassiveProfession(profession)
    ? Number((1 + weakness.bonus).toFixed(10))
    : 1;
}

