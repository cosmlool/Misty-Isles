import { calculateCombatSpeed } from './monsterBattle.js';

export type MonsterCombatEffectTarget =
  | 'attack'
  | 'defense'
  | 'critChance'
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
  | 'healing'
  | 'support'
  | 'unknown';

export type ParsedMonsterCombatEffect = {
  target: MonsterCombatEffectTarget;
  value: number;
};

/**
 * Parses one catalog effect clause into a typed modifier.
 * Unknown or compound descriptions are deliberately not guessed or converted to attack.
 */
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
    /сопротивлен/i.test(text) ? 'resistance' :
    /лечени|восстановлени\w*\s+hp/i.test(text) ? 'healing' :
    /поддержк|положительн\w*\s+эффект/i.test(text) ? 'support' :
    /производств/i.test(text) ? 'production' :
    /опыт/i.test(text) ? 'experience' :
    /золот/i.test(text) ? 'gold' :
    /максимальн\w*\s+hp|здоровь/i.test(text) ? 'health' :
    /защит/i.test(text) ? 'defense' :
    /атак/i.test(text) ? 'attack' :
    /сопротивлен/i.test(text) ? 'resistance' :
    undefined;

  return target ? { target, value: amount } : undefined;
}

export type MonsterCombatSetBonusInput = {
  effect: string;
  itemCount: number;
  mastery: number;
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
  buffs?: Partial<MonsterCombatBuffInput>;
  now?: number;
  buffUntil?: number;
  /** Preserve the legacy dungeon rule, which does not apply the extra 5-piece multiplier. */
  applyFivePieceSetBonus?: boolean;
};

export type PlayerMonsterCombatStats = {
  attack: number;
  defense: number;
  speed: number;
  profession: string;
  lootBonus: number;
  lifestealBonus: number;
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

  return {
    attack: Math.max(1, Number.isFinite(attack) ? attack : 1),
    defense: Math.max(1, Number.isFinite(defense) ? defense : 1),
    speed: calculateCombatSpeed(value(input.dexterity), value(input.weaponDexterityBonus)),
    profession,
    lootBonus: value(input.weaponLootBonus) + (buffActive ? value(buffs.loot) : 0),
    lifestealBonus: buffActive ? value(buffs.lifesteal) : 0,
  };
}
