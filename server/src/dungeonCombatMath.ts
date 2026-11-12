export type DungeonCombatMathParticipant = {
  attack: number;
  defense: number;
  health: number;
  outgoingMultiplier: number;
  incomingMultiplier: number;
};

export type DungeonCombatMathInput = {
  dungeonPower: number;
  partySize: number;
  bossDefense: number;
  bossAttack: number;
  bossAccuracy: number;
  groupGuard: number;
  participants: DungeonCombatMathParticipant[];
};

export type DungeonCombatMathResult = {
  rounds: number;
  incoming: number[];
  win: boolean;
  damageByParticipant: number[];
};

/**
 * Pure extraction of the legacy boss-dungeon combat calculation.
 * All profession/passive/weakness multipliers are resolved by the caller;
 * this function deliberately owns no game data and applies no random effects.
 */
export function calculateDungeonCombatPlan(input: DungeonCombatMathInput): DungeonCombatMathResult {
  const finite = [
    input.dungeonPower, input.partySize, input.bossDefense, input.bossAttack,
    input.bossAccuracy, input.groupGuard,
    ...input.participants.flatMap(p => [
      p.attack, p.defense, p.health, p.outgoingMultiplier, p.incomingMultiplier,
    ]),
  ];
  if (input.participants.length < 1 || input.participants.length > 3 ||
    !finite.every(Number.isFinite) ||
    !Number.isInteger(input.partySize) || input.partySize !== input.participants.length ||
    input.dungeonPower < 0 || input.bossDefense < 0 || input.bossAttack < 0 ||
    input.groupGuard < 0 || input.groupGuard > 1 ||
    input.participants.some(p => p.attack < 0 || p.defense < 0 || p.health < 0 ||
      p.outgoingMultiplier < 0 || p.incomingMultiplier < 0)) {
    throw new Error('Invalid dungeon combat calculation input.');
  }

  const outgoingPerParticipant = input.participants.map(participant =>
    participant.attack * 7 * (100 / (100 + input.bossDefense)) * participant.outgoingMultiplier);
  const totalAttack = outgoingPerParticipant.reduce((sum, damage) => sum + damage, 0);
  const totalDefense = input.participants.reduce((sum, participant) => sum + participant.defense * 0.65, 0);
  const scaledPower = input.dungeonPower * (1 + 0.45 * (input.partySize - 1));
  const rounds = Math.max(1, Math.ceil(scaledPower * 1.35 / Math.max(1, totalAttack + totalDefense)));
  const incoming = input.participants.map(participant =>
    Math.max(1, Math.floor((input.bossAttack * 0.14 - participant.defense * 0.10) *
      rounds * (1 - input.groupGuard) * participant.incomingMultiplier)));
  const damageByParticipant = outgoingPerParticipant.map(damage => damage * rounds);
  const win = rounds <= 3 && input.participants.every((participant, index) => participant.health > incoming[index]);

  return { rounds, incoming, win, damageByParticipant };
}
