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
  controlResistance: number;
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
    goldBonus: 0, productionBonus: 0, resistanceBonus: 0, controlResistance: 0, healingBonus: 0,
  };
  const targets: Partial<Record<MonsterCombatEffectTarget, keyof MonsterCombatModifiers>> = {
    attack: 'attackBonus', defense: 'defenseBonus',
    critChance: 'critChanceBonus', critChanceMultiplier: 'critChanceMultiplierBonus', critDamage: 'critDamageBonus',
    lifesteal: 'lifestealBonus', loot: 'lootBonus', health: 'healthBonus',
    accuracy: 'accuracyBonus', evasion: 'evasionBonus',
    attackSpeed: 'attackSpeedBonus', magicDamage: 'magicDamageBonus',
    physicalDamage: 'physicalDamageBonus', bossDamage: 'bossDamageBonus',
    experience: 'experienceBonus', gold: 'goldBonus',
    production: 'productionBonus', resistance: 'resistanceBonus', controlResistance: 'controlResistance',
    healing: 'healingBonus',
  };
  for (const effect of effects) {
    if (!effect || !Number.isFinite(effect.value)) continue;
    const key = targets[effect.target];
    if (key) result[key] = Number((result[key] + effect.value).toFixed(10));
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
    /критическ\p{L}*\s+(?:шанс|вероятност)\p{L}*/iu.test(text) ? 'critChance' :
    /критическ\p{L}*\s+урон\p{L}*/iu.test(text) ? 'critDamage' :
    /вампиризм|похищен\p{L}*\s+здоров\p{L}*|восстанавлива\p{L}*\s+\d/iu.test(text) ? 'lifesteal' :
    /золот/iu.test(text) ? 'gold' :
    /добыч|ресурс|трофе|редк\p{L}*\s+материал\p{L}*/iu.test(text) ? 'loot' :
    /магическ\p{L}*\s+урон\p{L}*/iu.test(text) ? 'magicDamage' :
    /физическ\p{L}*\s+урон\p{L}*/iu.test(text) ? 'physicalDamage' :
    /урон\p{L}*\s+по\s+босс\p{L}*|босс\p{L}*\s+урон\p{L}*/iu.test(text) ? 'bossDamage' :
    /скорост\p{L}*\s+атак\p{L}*/iu.test(text) ? 'attackSpeed' :
    /точност|меткост/iu.test(text) ? 'accuracy' :
    /уклонен|уклонени/iu.test(text) ? 'evasion' :
    /сопротивлен\p{L}*\s+(?:контрол\p{L}*|отрицательн\p{L}*\s+эффект\p{L}*)/iu.test(text) ? 'controlResistance' :
    /сопротивлен\p{L}*\s+(?:входящ\p{L}*\s+)?(?:урон\p{L}*|поврежден\p{L}*)/iu.test(text) ? 'resistance' :
    /\b\d+\/\d+\s*:\s*[+-]?\d+(?:[.,]\d+)?\s*%\s+сопротивлен\p{L}*/iu.test(text) ? 'resistance' :
    /лечени|восстановлени\p{L}*\s+hp/iu.test(text) ? 'healing' :
    /поддержк|положительн\p{L}*\s+эффект\p{L}*/iu.test(text) ? 'support' :
    /производств/iu.test(text) ? 'production' :
    /опыт/iu.test(text) ? 'experience' :
    /\bhp\b|максимальн\p{L}*\s+hp|здоровь/iu.test(text) ? 'health' :
    /защит/iu.test(text) ? 'defense' :
    /атак/iu.test(text) ? 'attack' :
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

export type EquipmentSetTierDescriptions = {
  itemCount: number;
  two?: string;
  three?: string;
  four?: string;
  full?: string;
  /** Number of equipped pieces required for the full tier; defaults to five. */
  fullAt?: number;
};

/** Return only the exact set tiers the equipped item count has unlocked. */
export function resolveEquipmentSetTierDescriptions(input: EquipmentSetTierDescriptions): string[] {
  const count = Math.max(0, Math.floor(Number.isFinite(input.itemCount) ? input.itemCount : 0));
  const descriptions: string[] = [];
  if (count >= 2 && input.two) descriptions.push(input.two);
  if (count >= 3 && input.three) descriptions.push(input.three);
  if (count >= 4 && input.four) descriptions.push(input.four);
  const fullAt = Number.isFinite(input.fullAt) ? Math.max(2, Math.floor(input.fullAt as number)) : 5;
  if (count >= fullAt && input.full) descriptions.push(input.full);
  return descriptions;
}

/** Parse only the explicitly unlocked tier descriptions into typed combat effects. */
export function resolveEquipmentSetCombatEffects(
  input: EquipmentSetTierDescriptions,
): ParsedMonsterCombatEffect[] {
  return resolveEquipmentSetTierDescriptions(input)
    .flatMap(description => parseMonsterCombatEffectClauses(description));
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
  strength?: number;
  dexterity?: number;
  intelligence?: number;
  vitality?: number;
  stamina?: number;
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

/**
 * Convert the live character HP snapshot into the pre-percentage base HP
 * contract expected by the typed battle engine. The current HP ratio is
 * measured against the legacy effective maximum (including currently applied
 * equipment health), then projected onto baseMaxHp. The engine applies the
 * aggregated healthBonus exactly once after adaptation.
 */
export type PlayerMonsterCombatHealthInput = {
  currentHp: number;
  legacyEffectiveMaxHp: number;
  baseMaxHp: number;
};

export type PlayerMonsterCombatHealth = { hp: number; maxHp: number };

/** Combines the Vampire profession baseline with already-aggregated gear, set and active-buff lifesteal once. */
export function resolvePlayerMonsterLifestealRate(profession: string, aggregatedBonus: number): number {
  const professionBonus = profession === 'Вампир' ? 0.08 : 0;
  const bonus = Number.isFinite(aggregatedBonus) ? Math.max(0, aggregatedBonus) : 0;
  return Math.min(1, professionBonus + bonus);
}

export function resolvePlayerMonsterCombatHealth(
  input: PlayerMonsterCombatHealthInput,
): PlayerMonsterCombatHealth {
  const baseMaxHp = Number.isFinite(input.baseMaxHp) ? Math.max(1, input.baseMaxHp) : 1;
  const effectiveMaxHp = Number.isFinite(input.legacyEffectiveMaxHp)
    ? Math.max(1, input.legacyEffectiveMaxHp)
    : 1;
  const currentHp = Number.isFinite(input.currentHp) ? Math.max(0, input.currentHp) : 0;
  const healthRatio = Math.min(1, currentHp / effectiveMaxHp);
  return { hp: Math.min(baseMaxHp, Math.floor(baseMaxHp * healthRatio)), maxHp: baseMaxHp };
}

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

export type GoldEquipmentStatProfileInput = {
  kind: 'weapon' | 'armor';
  level: number;
  profession?: string;
  slot?: string;
};
export type GoldEquipmentStatProfile = {
  attributes: Record<string, number>;
  combatStats: Record<string, number>;
};

/** Deterministic level- and role-scaled profile for gold-purchasable gear. */
export function resolveGoldEquipmentStatProfile(input: GoldEquipmentStatProfileInput): GoldEquipmentStatProfile {
  const profession = String(input.profession || '');
  const level = Math.max(1, Number.isFinite(input.level) ? input.level : 1);
  const mainStat: Record<string, string> = {
    'Боевой маг': 'intelligence', 'Ассасин': 'dexterity', 'Воин': 'strength',
    'Баффер': 'intelligence', 'Лучник': 'dexterity', 'Вампир': 'stamina', 'Добытчик': 'intelligence',
  };
  const secondaryStat: Record<string, string> = {
    'Боевой маг': 'stamina', 'Ассасин': 'strength', 'Воин': 'stamina',
    'Баффер': 'vitality', 'Лучник': 'stamina', 'Вампир': 'vitality', 'Добытчик': 'dexterity',
  };
  const unit = profession ? Math.max(1, Math.round(level / 20)) : Math.max(1, Math.round(level / 10));
  const attributes: Record<string, number> = {};
  const combatStats: Record<string, number> = {};
  const addAttribute = (key: string, amount: number) => { attributes[key] = Math.max(1, Math.round(amount)); };

  if (input.kind === 'weapon') {
    addAttribute(secondaryStat[profession] || 'stamina', unit * (profession ? 0.55 : 0.35));
    if (profession === 'Воин' || profession === 'Вампир') addAttribute('vitality', unit * 0.25);
  } else {
    const slot = String(input.slot || 'armor');
    const primary = mainStat[profession] || 'strength';
    if (slot === 'helmet') {
      addAttribute(primary, unit * 0.35);
      if (profession === 'Боевой маг' || profession === 'Баффер') addAttribute('stamina', unit * 0.2);
    } else if (slot === 'armor') {
      addAttribute('vitality', unit * 0.8);
      addAttribute('stamina', unit * 0.45);
    } else if (slot === 'gloves') {
      addAttribute(primary, unit * 0.45);
      if (profession === 'Ассасин' || profession === 'Лучник') addAttribute('dexterity', unit * 0.25);
    } else if (slot === 'boots') {
      addAttribute('dexterity', unit * 0.65);
      if (profession === 'Воин' || profession === 'Вампир') addAttribute('vitality', unit * 0.2);
    } else if (slot === 'cloak') {
      addAttribute('stamina', unit * 0.55);
      addAttribute('vitality', unit * 0.35);
    }
  }

  const q = Math.round((0.004 + 0.016 * (level / 100)) * 1000) / 1000;
  const q2 = Math.round(q * 0.55 * 1000) / 1000;
  if (input.kind === 'weapon') {
    const damage = profession === 'Боевой маг' ? 'magicDamage' : profession === 'Баффер' ? 'healing' : 'physicalDamage';
    combatStats[damage] = Math.round(q * 1.5 * 1000) / 1000;
    if (profession === 'Ассасин' || profession === 'Лучник') combatStats.critChance = q2;
    else if (profession === 'Воин') combatStats.critDamage = q2;
    else if (profession === 'Вампир') combatStats.lifesteal = q2;
    else if (profession === 'Добытчик') combatStats.loot = Math.round(q * 2 * 1000) / 1000;
    else if (!profession) combatStats.accuracy = q2;
  } else {
    const slot = String(input.slot || 'armor');
    if (slot === 'helmet') {
      if (['Боевой маг', 'Ассасин', 'Лучник'].includes(profession)) combatStats.accuracy = q;
      else combatStats.controlResistance = q;
      if (profession === 'Ассасин' || profession === 'Лучник') combatStats.critChance = q2;
    } else if (slot === 'armor') {
      combatStats.resistance = q;
      combatStats.health = q2;
    } else if (slot === 'gloves') {
      combatStats[profession === 'Боевой маг' ? 'magicDamage' : profession === 'Баффер' ? 'healing' : 'physicalDamage'] = q;
      if (profession === 'Ассасин' || profession === 'Лучник') combatStats.critDamage = q2;
      else if (profession === 'Вампир') combatStats.lifesteal = q2;
      else if (profession === 'Добытчик') combatStats.loot = q2;
    } else if (slot === 'boots') {
      combatStats.evasion = q;
      combatStats.attackSpeed = q2;
    } else if (slot === 'cloak') {
      if (profession === 'Баффер') combatStats.healing = q2;
      else if (profession === 'Вампир') combatStats.lifesteal = q2;
      else if (profession === 'Добытчик') combatStats.loot = q2;
      else combatStats.controlResistance = q2;
    }
  }
  return { attributes, combatStats };
}

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
  const armorAttributes = (key: 'strength' | 'dexterity' | 'intelligence' | 'vitality' | 'stamina') =>
    (input.armorItems || []).reduce((sum, item) => sum + value(item[key]), 0);
  const totalStrength = value(input.strength) + value(input.weaponStrength) + armorAttributes('strength');
  const totalDexterity = value(input.dexterity) + value(input.weaponDexterity) + armorAttributes('dexterity');
  const totalIntelligence = value(input.intelligence) + value(input.weaponIntelligence) + armorAttributes('intelligence');
  const totalVitality = value(input.vitality) + value(input.weaponVitality) + armorAttributes('vitality');
  const totalStamina = value(input.stamina) + value(input.weaponStamina) + armorAttributes('stamina');

  let attack =
    totalStrength * (magic ? 0.35 : 1.25) +
    totalDexterity * (agile ? 0.65 : 0.35) +
    totalIntelligence * (magic ? 0.85 : 0.2) +
    enhancedWeaponAttack +
    armorAttack;

  let defense =
    value(input.baseDefense) +
    totalVitality * 0.45 +
    totalStamina * 0.12 +
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
  // Only explicit tier descriptions are promoted into typed modifiers.
  const profileEffects: ParsedMonsterCombatEffect[] = profileBonus > 0
    ? [{ target: profession === 'Баффер' ? 'defense' : 'attack', value: profileBonus }]
    : [];
  const activeBuffEffects: ParsedMonsterCombatEffect[] = buffActive
    ? [
        { target: 'attack', value: value(buffs.attack) },
        { target: 'defense', value: value(buffs.defense) },
        // In the typed engine crit buffs increase critical chance, not base attack.
        { target: 'critChance', value: value(buffs.crit) },
      ]
    : [];
  const combatModifiers = aggregateMonsterCombatModifiers([
    ...(input.equipmentEffects || []),
    ...(input.pendantCombatEffect ? [input.pendantCombatEffect] : []),
    ...setEffects,
    ...profileEffects,
    ...activeBuffEffects,
  ]);

  return {
    attack: Math.max(1, Number.isFinite(attack) ? attack : 1),
    defense: Math.max(1, Number.isFinite(defense) ? defense : 1),
    baseAttack: Math.max(1, Number.isFinite(baseAttack) ? baseAttack : 1),
    baseDefense: Math.max(1, Number.isFinite(baseDefense) ? baseDefense : 1),
    speed: calculateCombatSpeed(value(input.dexterity) + armorAttributes('dexterity'), value(input.weaponDexterityBonus)),
    profession,
    lootBonus: value(input.weaponLootBonus) + (buffActive ? value(buffs.loot) : 0) + combatModifiers.lootBonus,
    lifestealBonus: (buffActive ? value(buffs.lifesteal) : 0) + combatModifiers.lifestealBonus,
    combatModifiers,
  };
}
