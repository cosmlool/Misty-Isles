export function prepareDungeonMemberHealthOutcome(input: {
  health: number;
  incomingDamage: number;
  maxHealth: number;
  lifestealRate?: number;
  attack?: number;
  healingMultiplier?: number;
  hasBuffer?: boolean;
}): number {
  let health = Math.max(1, input.health - input.incomingDamage);
  const healingMultiplier = input.healingMultiplier ?? 1;

  if ((input.lifestealRate ?? 0) > 0) {
    health = Math.min(
      input.maxHealth,
      health + Math.floor((input.attack ?? 0) * (input.lifestealRate ?? 0) * healingMultiplier),
    );
  }

  if (input.hasBuffer) {
    health = Math.min(
      input.maxHealth,
      health + Math.floor(input.maxHealth * 0.04 * healingMultiplier),
    );
  }

  return health;
}
