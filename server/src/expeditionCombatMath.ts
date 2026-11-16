export type ExpeditionCombatParticipant = {
  attack: number; defense: number; health: number;
  resistanceMultiplier: number; weaknessMultiplier: number; hitMultiplier: number;
  incomingProfessionMultiplier: number; incomingHitMultiplier: number;
};
export type ExpeditionCombatInput = {
  monsterHp: number; partySize: number; monsterDefense: number; monsterDefenseMultiplier: number;
  monsterAttack: number; monsterAttackMultiplier: number; groupGuard: number;
  participants: ExpeditionCombatParticipant[];
};
export type ExpeditionCombatResult = {
  groupHp: number; effectiveMonsterDefense: number; monsterAttack: number; totalDps: number;
  rounds: number; incoming: number[]; win: boolean;
};
/** Pure extraction of legacy expedition arithmetic; all effect multipliers are resolved by the caller. */
export function calculateExpeditionCombatPlan(input: ExpeditionCombatInput): ExpeditionCombatResult {
  const groupHp = input.monsterHp * (1 + .55 * (input.partySize - 1));
  const effectiveMonsterDefense = Math.max(0, Number(input.monsterDefense || 0)) * input.monsterDefenseMultiplier;
  const totalDps = input.participants.reduce((sum, participant) =>
    sum + participant.attack * 7 * (100 / (100 + effectiveMonsterDefense)) *
      participant.resistanceMultiplier * participant.weaknessMultiplier * participant.hitMultiplier, 0);
  const rounds = Math.max(1, Math.ceil(groupHp / Math.max(1, totalDps)));
  const monsterAttack = input.monsterAttack * input.monsterAttackMultiplier;
  const incoming = input.participants.map(participant =>
    Math.max(1, Math.floor((monsterAttack * .20 - participant.defense * .12) *
      rounds * participant.incomingProfessionMultiplier * (1 - input.groupGuard) *
      participant.incomingHitMultiplier)));
  const win = rounds <= 8 && input.participants.every((participant, index) => participant.health > incoming[index]);
  return { groupHp, effectiveMonsterDefense, monsterAttack, totalDps, rounds, incoming, win };
}
