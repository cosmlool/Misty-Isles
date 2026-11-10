import type { MonsterBattleCombatant, MonsterDamageType } from './monsterBattle.js';
import type { MonsterCombatModifiers } from './monsterCombatStats.js';
import { calculateCombatSpeed } from './monsterBattle.js';

/**
 * Explicit, already-resolved player combat values.
 * Equipment, set bonuses and active buffs must be calculated by the caller
 * using the game's existing rules before constructing this input.
 */
export type PlayerCombatantAdapterInput = {
  id: string;
  profession: string;
  hp: number;
  maxHp: number;
  /** Base attack before active buff modifiers; the battle engine applies buff fields below. */
  attack: number;
  /** Base defense before active buff modifiers; the battle engine applies buff fields below. */
  defense: number;
  dexterity: number;
  equipmentDexterityBonus?: number;
  damageType?: MonsterDamageType;
  /** Probability in the [0, 1] range; omit until a trusted source is resolved. */
  critChance?: number;
  critMultiplier?: number;
  /** Normalized accuracy value expected by the battle engine; omit if unresolved. */
  accuracy?: number;
  /** Typed equipment/set/pendant effects; must not already be folded into attack/defense. */
  combatModifiers?: Partial<MonsterCombatModifiers>;
  buff?: string;
  buffValue?: number;
  buffSecondaryEffect?: string;
  buffSecondaryValue?: number;
  buffUntil?: number;
};

const finiteNonNegative = (value: number | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;

/** Converts resolved player stats into the shared monster battle combatant contract. */
export function adaptPlayerCombatant(input: PlayerCombatantAdapterInput): MonsterBattleCombatant {
  const maxHp = Math.max(1, finiteNonNegative(input.maxHp, 1));
  const hp = Math.min(maxHp, finiteNonNegative(input.hp));
  const result: MonsterBattleCombatant = {
    id: String(input.id || ''),
    profession: String(input.profession || 'Без профессии'),
    hp,
    maxHp,
    attack: finiteNonNegative(input.attack),
    defense: finiteNonNegative(input.defense),
    speed: calculateCombatSpeed(input.dexterity, input.equipmentDexterityBonus ?? 0),
  };

  if (input.damageType) result.damageType = input.damageType;
  if (input.critChance !== undefined && Number.isFinite(input.critChance)) {
    result.critChance = Math.min(1, Math.max(0, input.critChance));
  }
  if (input.critMultiplier !== undefined && Number.isFinite(input.critMultiplier)) {
    result.critMultiplier = Math.max(1, input.critMultiplier);
  }
  if (input.accuracy !== undefined && Number.isFinite(input.accuracy)) {
    result.accuracy = Math.max(0, input.accuracy);
  }
  if (input.combatModifiers) {
    result.combatModifiers = Object.fromEntries(
      Object.entries(input.combatModifiers).filter((entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    ) as MonsterBattleCombatant['combatModifiers'];
  }
  if (typeof input.buff === 'string' && input.buff) result.buff = input.buff;
  if (input.buffValue !== undefined && Number.isFinite(input.buffValue)) {
    result.buffValue = input.buffValue;
  }
  if (typeof input.buffSecondaryEffect === 'string' && input.buffSecondaryEffect) {
    result.buffSecondaryEffect = input.buffSecondaryEffect;
  }
  if (input.buffSecondaryValue !== undefined && Number.isFinite(input.buffSecondaryValue)) {
    result.buffSecondaryValue = input.buffSecondaryValue;
  }
  if (input.buffUntil !== undefined && Number.isFinite(input.buffUntil)) {
    result.buffUntil = input.buffUntil;
  }

  return result;
}
