export type XpProgressionState = {
  experience: number;
  level: number;
  statPoints: number;
  experienceToNext: number;
  maxHealth: number;
  health: number;
  vitality: number;
};

export type XpProgressionResult = Pick<
  XpProgressionState,
  'experience' | 'level' | 'statPoints' | 'experienceToNext' | 'maxHealth' | 'health'
>;

function xpRequired(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.85));
}

/**
 * Calculates XP and level-up changes without mutating the supplied player.
 * The callback must calculate effective max health using the supplied base maxHealth.
 */
export function prepareXpProgression(
  player: XpProgressionState,
  amount: number,
  resolveEffectiveMaxHealth: (baseMaxHealth: number) => number,
): XpProgressionResult {
  let experience = player.experience + amount;
  let level = player.level;
  let statPoints = player.statPoints;
  let experienceToNext = player.experienceToNext;
  let maxHealth = player.maxHealth;
  let health = player.health;

  while (experience >= xpRequired(level)) {
    experience -= xpRequired(level);
    level++;
    statPoints += 3;
    experienceToNext = xpRequired(level);
    const healthIncrease = 18 + player.vitality * 0.5;
    maxHealth += healthIncrease;
    health = Math.min(resolveEffectiveMaxHealth(maxHealth), health + healthIncrease);
  }

  return { experience, level, statPoints, experienceToNext, maxHealth, health };
}
