import { calculateCombatSpeed } from './monsterBattle.js';

export type MonsterCombatEffectTarget =
  | 'attack'
  | 'defense'
  | 'critChance'
  | 'critChanceMultiplier'
  | 'critDamage'
  | 'lifesteal'
  | 'loot'
  | 'health'
  | 'accuracy'
  | 'evasion'
  | 'attackSpeed'
  | 'magicDamage'
  | 'physicalDamage'
  | 'bossDamage'
  | 'experience'
  | 'gold'
  | 'production'
  | 'resistance'
  | 'controlResistance'
  | 'healing'
  | 'support'
  | 'unknown';

export type ParsedMonsterCombatEffect = {
  target: MonsterCombatEffectTarget;
  value: number;
};

/**
 * Additive, typed modifiers kept separate from legacy attack/defense totals.
 * Values are decimal fractions (0.05 = +5%). Unknown/support clauses are ignored.
 */
export type MonsterCombatModifiers = {
  attackBonus: number;
  defenseBonus: number;
  critChanceBonus: number;
  critChanceMultiplierBonus: number;
  critDamageBonus: number;
  lifestealBonus: number;
  lootBonus: number;
  healthBonus: number;
  accuracyBonus: number;
  evasionBonus: number;
  attackSpeedBonus: number;
  magicDamageBonus: number;
  physicalDamageBonus: number;
  bossDamageBonus: number;
  experienceBonus: number;
  goldBonus: number;
  productionBonus: number;
  resistanceBonus: number;
  healingBonus: number;
};

/** Aggregate already-resolved effect clauses without converting one stat into another. */
export function aggregateMonsterCombatModifiers(
  effects: readonly (ParsedMonsterCombatEffect | undefined)[],
): MonsterCombatModifiers {
  const result: MonsterCombatModifiers = {
    attackBonus: 0, defenseBonus: 0, critChanceBonus: 0, critChanceMultiplierBonus: 0, critDamageBonus: 0,
    lifestealBonus: 0, lootBonus: 0, healthBonus: 0, accuracyBonus: 0,
    evasionBonus: 0, attackSpeedBonus: 0, magicDamageBonus: 0,
    physicalDamageBonus: 0, bossDamageBonus: 0, experienceBonus: 0,
    goldBonus: 0, productionBonus: 0, resistanceBonus: 0, healingBonus: 0,
  };
  const targets: Partial<Record<MonsterCombatEffectTarget, keyof MonsterCombatModifiers>> = {
    attack: 'attackBonus', defense: 'defenseBonus',
    critChance: 'critChanceBonus', critChanceMultiplier: 'critChanceMultiplierBonus', critDamage: 'critDamageBonus',
    lifesteal: 'lifestealBonus', loot: 'lootBonus', health: 'healthBonus',
    accuracy: 'accuracyBonus', evasion: 'evasionBonus',
    attackSpeed: 'attackSpeedBonus', magicDamage: 'magicDamageBonus',
    physicalDamage: 'physicalDamageBonus', bossDamage: 'bossDamageBonus',
    experience: 'experienceBonus', gold: 'goldBonus',
    production: 'productionBonus', resistance: 'resistanceBonus',
    healing: 'healingBonus',
  };
  for (const effect of effects) {
    if (!effect || !Number.isFinite(effect.value)) continue;
    const key = targets[effect.target];
    if (key) result[key] += effect.value;
  }
  return result;
}

/**
 * Parses one catalog effect clause into a typed modifier.
 * Unknown or compound descriptions are deliberately not guessed or converted to attack.
 */
/** Parse a description containing multiple explicitly joined percentage clauses. */
export function parseMonsterCombatEffectClauses(description: string): ParsedMonsterCombatEffect[] {
  const text = String(description || '').trim();
  if (!text) return [];
  const clauses = text.split(/\s+и\s+/i);
  if (clauses.length === 1) {
    const parsed = parseMonsterCombatEffect(text);
    return parsed ? [parsed] : [];
  }
  const parsed = clauses.map(clause => parseMonsterCombatEffect(clause));
  return parsed.every((effect): effect is ParsedMonsterCombatEffect => Boolean(effect)) ? parsed : [];
}

export function parseMonsterCombatEffect(description: string): ParsedMonsterCombatEffect | undefined {
  const text = String(description || '').trim().toLocaleLowerCase('ru');
  if (/[;；]/.test(text)) return undefined;
  const matches = [...text.matchAll(/([+-]?\d+(?:[.,]\d+)?)\s*%/g)];
  if (matches.length !== 1) return undefined;
  const match = matches[0];
  const amount = Number(match[1].replace(',', '.')) / 100;
  if (!Number.isFinite(amount)) return undefined;

  const target: MonsterCombatEffectTarget | undefined =
    /критическ\w*\s+(?:шанс|вероятност)/i.test(text) ? 'critChance' :
    /критическ\w*\s+урон/i.test(text) ? 'critDamage' :
    /вампиризм|похищен\w*\s+здоров|восстанавлива\w*\s+\d/i.test(text) ? 'lifesteal' :
    /добыч|ресурс|трофе|редк\w*\s+материал/i.test(text) ? 'loot' :
    /магическ\w*\s+урон/i.test(text) ? 'magicDamage' :
    /физическ\w*\s+урон/i.test(text) ? 'physicalDamage' :
    /урон\s+по\s+босс|босс\w*\s+урон/i.test(text) ? 'bossDamage' :
    /скорост\w*\s+атак/i.test(text) ? 'attackSpeed' :
    /точност|меткост/i.test(text) ? 'accuracy' :
    /уклонен|уклонени/i.test(text) ? 'evasion' :
    /сопротивлен\w*\s+(?:контрол|отрицательн\w*\s+эффект)/i.test(text) ? 'controlResistance' :
    /сопротивлен\w*\s+(?:входящ\w*\s+)?(?:урон|поврежден)/i.test(text) ? 'resistance' :
    /лечени|восстановлени\w*\s+hp/i.test(text) ? 'healing' :
    /поддержк|положительн\w*\s+эффект/i.test(text) ? 'support' :
    /производств/i.test(text) ? 'production' :
    /опыт/i.test(text) ? 'experience' :
    /золот/i.test(text) ? 'gold' :
    /\bhp\b|максимальн\w*\s+hp|здоровь/i.test(text) ? 'health' :
    /защит/i.test(text) ? 'defense' :
    /атак/i.test(text) ? 'attack' :
    undefined;

  return target ? { target, value: amount } : undefined;
}

/** Resolve catalog property identifiers without guessing from display text. */
export function resolveMonsterCombatProperty(effect: string, amount: number): ParsedMonsterCombatEffect | undefined {
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const targets: Record<string, MonsterCombatEffectTarget> = {
    attack: 'attack', defense: 'defense', crit: 'critChance', critical: 'critChance',
    lifesteal: 'lifesteal', loot: 'loot', bossDamage: 'bossDamage',
  };
  const target = targets[String(effect || '')];
  return target ? { target, value: amount } : undefined;
}

/** Pendant crit is a relative multiplier to base crit chance, unlike flat rare-property crit. */
export function resolveMonsterPendantCombatEffect(effect: string, amount: number): ParsedMonsterCombatEffect | undefined {
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const targets: Record<string, MonsterCombatEffectTarget> = {
    defense: 'defense', crit: 'critChanceMultiplier', bossDamage: 'bossDamage', lifesteal: 'lifesteal',
    health: 'health', loot: 'loot', xp: 'experience', gold: 'gold', production: 'production',
  };
  const target = targets[String(effect || '')];
  return target ? { target, value: amount } : undefined;
}

export type MonsterCombatSetBonusInput = {
  effect: string;
  itemCount: number;
  mastery: number;
  descriptions?: string[];
};

export type MonsterCombatArmorItemInput = {
  attack?: number;
  defense?: number;
  enhancementLevel?: number;
};

export type MonsterCombatBuffInput = {
  attack: number;
  crit: number;
  defense: number;
  loot: number;
  lifesteal: number;
};

export type PlayerMonsterStatsInput = {
  profession: string;
  strength: number;
  dexterity: number;
  intelligence: number;
  vitality: number;
  stamina: number;
  baseDefense: number;
  weaponStrength?: number;
  weaponDexterity?: number;
  weaponIntelligence?: number;
  weaponVitality?: number;
  weaponStamina?: number;
  /** Base weapon attack; weapon enhancement is applied here when supplied. */
  weaponAttack?: number;
  weaponEnhancementLevel?: number;
  /** Per-piece armor values; each piece receives its own legacy enhancement multiplier. */
  armorItems?: MonsterCombatArmorItemInput[];
  /** Pre-resolved legacy aggregates, used only when armorItems is omitted. */
  armorAttack?: number;
  armorDefense?: number;
  weaponDexterityBonus?: number;
  weaponProfileBonus?: number;
  weaponLootBonus?: number;
  pendantEffect?: string;
  pendantValue?: number;
  isBoss?: boolean;
  setBonuses?: MonsterCombatSetBonusInput[];
  equipmentEffects?: ParsedMonsterCombatEffect[];
  pendantCombatEffect?: ParsedMonsterCombatEffect;
  buffs?: Partial<MonsterCombatBuffInput>;
  now?: number;
  buffUntil?: number;
  /** Preserve the legacy dungeon rule, which does not apply the extra 5-piece multiplier. */
  applyFivePieceSetBonus?: boolean;
};

export type PlayerMonsterCombatStats = {
  /** Legacy totals retained for existing expedition/dungeon callers. */
  attack: number;
  defense: number;
  /** Clean inputs for the typed combat engine; percentage modifiers are not folded in. */
  baseAttack: number;
  baseDefense: number;
  speed: number;
  profession: string;
  lootBonus: number;
  lifestealBonus: number;
  combatModifiers: MonsterCombatModifiers;
};

const value = (n: number | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : 0;

/**
 * Pure extraction of the existing expedition/dungeon player-stat formula.
 * Inputs are resolved by the caller from Player, inventory and equipment.
 * This deliberately preserves legacy differences; it does not invent crit chance,
 * accuracy or evasion values.
 */
export function calculatePlayerMonsterCombatStats(
  input: PlayerMonsterStatsInput,
): PlayerMonsterCombatStats {
  const profession = String(input.profession || '');
  const magic = profession === 'Боевой маг';
  const agile = ['Ассасин', 'Лучник', 'Вампир'].includes(profession);
  const weaponEnhancement = Math.max(0, value(input.weaponEnhancementLevel));
  const enhancedWeaponAttack = value(input.weaponAttack) * (1 + weaponEnhancement * 0.04);
  const armorAttack = input.armorItems
    ? input.armorItems.reduce((sum, item) => sum + value(item.attack) * (1 + Math.max(0, value(item.enhancementLevel)) * 0.04), 0)
    : value(input.armorAttack);
  const armorDefense = input.armorItems
    ? input.armorItems.reduce((sum, item) => sum + value(item.defense) * (1 + Math.max(0, value(item.enhancementLevel)) * 0.04), 0)
    : value(input.armorDefense);

  let attack =
    (value(input.strength) + value(input.weaponStrength)) * (magic ? 0.35 : 1.25) +
    (value(input.dexterity) + value(input.weaponDexterity)) * (agile ? 0.65 : 0.35) +
    (value(input.intelligence) + value(input.weaponIntelligence)) * (magic ? 0.85 : 0.2) +
    enhancedWeaponAttack +
    armorAttack;

  let defense =
    value(input.baseDefense) +
    (value(input.vitality) + value(input.weaponVitality)) * 0.45 +
    (value(input.stamina) + value(input.weaponStamina)) * 0.12 +
    armorDefense;

  if (profession === 'Боевой маг') attack *= 1.10;
  if (profession === 'Ассасин') attack *= 1.08;
  if (profession === 'Лучник') attack *= 1.06;
  if (profession === 'Воин') defense *= 1.10;

  // These are the new engine's clean stat inputs. Legacy totals continue below unchanged.
  const baseAttack = attack;
  const baseDefense = defense;

  const profileBonus = value(input.weaponProfileBonus);
  if (profileBonus) {
    if (profession === 'Баффер') defense *= 1 + profileBonus;
    else attack *= 1 + profileBonus;
  }

  for (const set of input.setBonuses || []) {
    const count = Math.max(0, value(set.itemCount));
    if (count < 2) continue;
    const bonus = count * 0.01 + value(set.mastery) * 0.01;
    if (set.effect === 'attack') attack *= 1 + bonus;
    else if (set.effect === 'defense') defense *= 1 + bonus;
    else if (set.effect === 'crit' || set.effect === 'lifesteal') attack *= 1 + bonus * 0.75;
    else if (set.effect === 'loot') attack *= 1 + bonus * 0.5;

    if (input.applyFivePieceSetBonus !== false && count >= 5) {
      if (set.effect === 'attack') attack *= 1.05;
      if (set.effect === 'defense') defense *= 1.05;
    }
  }

  const pendantValue = value(input.pendantValue);
  if (input.pendantEffect === 'defense') defense *= 1 + pendantValue;
  if (input.pendantEffect === 'crit') attack *= 1 + pendantValue * 0.5;
  if (input.pendantEffect === 'bossDamage' && (input.isBoss || input.isBoss === undefined)) {
    attack *= 1 + pendantValue;
  }

  const buffActive = value(input.buffUntil) > value(input.now);
  const buffs = input.buffs || {};
  if (buffActive) {
    attack *= 1 + value(buffs.attack);
    attack *= 1 + value(buffs.crit) * 0.5;
    defense *= 1 + value(buffs.defense);
  }

  const setEffects = (input.setBonuses || []).flatMap(set => (set.descriptions || []).flatMap(parseMonsterCombatEffectClauses));
  const profileEffects: ParsedMonsterCombatEffect[] = profileBonus > 0
    ? [{ target: profession === 'Баффер' ? 'defense' : 'attack', value: profileBonus }]
    : [];
  const combatModifiers = aggregateMonsterCombatModifiers([
    ...(input.equipmentEffects || []),
    ...(input.pendantCombatEffect ? [input.pendantCombatEffect] : []),
    ...setEffects,
    ...profileEffects,
  ]);

  return {
    attack: Math.max(1, Number.isFinite(attack) ? attack : 1),
    defense: Math.max(1, Number.isFinite(defense) ? defense : 1),
    baseAttack: Math.max(1, Number.isFinite(baseAttack) ? baseAttack : 1),
    baseDefense: Math.max(1, Number.isFinite(baseDefense) ? baseDefense : 1),
    speed: calculateCombatSpeed(value(input.dexterity), value(input.weaponDexterityBonus)),
    profession,
    lootBonus: value(input.weaponLootBonus) + (buffActive ? value(buffs.loot) : 0),
    lifestealBonus: buffActive ? value(buffs.lifesteal) : 0,
    combatModifiers,
  };
}
