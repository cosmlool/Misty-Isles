import { normalizeProfession } from './professionProfiles.js';

export interface PvpCombatProperty {
  effect?: string;
  value?: number;
}

export interface PvpCombatStatsInput {
  profession?: string;
  strength: number;
  dexterity: number;
  intelligence: number;
  defense: number;
  vitality: number;
  weaponAttack: number;
  weaponEnhancementLevel: number;
  armorDefense: number;
  armorEnhancementLevel: number;
  weaponProperty?: PvpCombatProperty;
  armorProperty?: PvpCombatProperty;
  hasAttackSet: boolean;
  hasDefenseSet: boolean;
  hasCritSet: boolean;
  attackBuff: number;
  defenseBuff: number;
  critBuff: number;
  attackRoll: number;
  scoreRoll: number;
}

export interface PvpCombatStats {
  attack: number;
  defense: number;
  score: number;
}

/**
 * Characterizes the existing arena rating formula. Random rolls are supplied by
 * the caller so the production path keeps its original randomness and tests can
 * assert exact outcomes without changing any coefficients.
 */
export function calculatePvpCombatStats(input: PvpCombatStatsInput): PvpCombatStats {
  const profession = input.profession || '';
  const normalized = normalizeProfession(profession);
  const isMage = profession === 'Боевой маг';
  const isAgile = ['Ассасин', 'Ассасин птицы', 'Лучник', 'Вампир'].includes(normalized);
  const weapon = input.weaponProperty;
  const armor = input.armorProperty;
  const attack = (
    input.strength * (isMage ? 0.35 : 1.25)
    + input.dexterity * (isAgile ? 0.65 : 0.35)
    + input.intelligence * (isMage ? 0.85 : 0.2)
    + input.weaponAttack * (1 + input.weaponEnhancementLevel * 0.04)
  )
    * (1 + (weapon?.effect === 'attack' ? Number(weapon.value || 0) : 0))
    * (input.hasAttackSet ? 1.08 : 1)
    * (profession === 'Боевой маг' ? 1.05 : 1)
    * (1 + input.attackBuff)
    + input.attackRoll;
  const defense = (
    input.defense + input.vitality * 0.45
    + input.armorDefense * (1 + input.armorEnhancementLevel * 0.04)
  )
    * (1 + (armor?.effect === 'defense' ? Number(armor.value || 0) : 0))
    * (input.hasDefenseSet ? 1.08 : 1)
    * (normalized === 'Рыцарь' ? 1.10 : profession === 'Баффер' ? 1.06 : 1)
    * (1 + input.defenseBuff);
  const professionCrit = profession === 'Ассасин' || profession === 'Ассасин птицы'
    ? 0.07
    : profession === 'Лучник' ? 0.03 : 0;
  const score = attack * (
    1
    + (weapon?.effect === 'crit' ? Number(weapon.value || 0) : 0)
    + (armor?.effect === 'crit' ? Number(armor.value || 0) : 0)
    + (input.hasCritSet ? 0.06 : 0)
    + professionCrit
    + input.critBuff
  ) + defense * 0.4 + input.scoreRoll;
  return { attack, defense, score };
}
