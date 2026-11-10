import { parseMonsterWeakness, resolveMonsterPassive, type MonsterPassiveEffect, type MonsterWeakness } from './monsterCombat.js';

export type MonsterDamageType = 'physical' | 'magic' | 'fire';

export type MonsterBattleCombatant = {
  id: string;
  profession: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  damageType?: MonsterDamageType;
  critChance?: number;
  critMultiplier?: number;
  accuracy?: number;
  blind?: boolean;
};

export type MonsterBattleInput = {
  monster: {
    id: string;
    name: string;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    passiveDescription?: string;
    weakness?: string;
    allies?: number;
  };
  party: MonsterBattleCombatant[];
  maxRounds?: number;
  random?: () => number;
};

export type MonsterBattleEvent = {
  round: number;
  actor: string;
  action: 'attack' | 'miss' | 'dodge' | 'heal' | 'poison';
  target: string;
  damage?: number;
  healing?: number;
  critical?: boolean;
};

export type MonsterBattleResult = {
  winner: 'party' | 'monster' | 'draw';
  rounds: number;
  monsterHp: number;
  party: Array<MonsterBattleCombatant & { remainingHp: number; damageDealt: number; damageTaken: number }>;
  events: MonsterBattleEvent[];
  totalDamageToMonster: number;
  totalDamageToParty: number;
  passiveDescription: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const safeStat = (value: number, fallback = 0) => Number.isFinite(value) ? Math.max(0, value) : fallback;
const damageThroughDefense = (attack: number, defense: number) =>
  Math.max(1, Math.floor(attack * (100 / (100 + safeStat(defense)))));

function professionMatches(left: string, right: string): boolean {
  const aliases: Record<string, string> = {
    'Маг': 'Боевой маг',
    'Убийца': 'Ассасин',
  };
  return (aliases[left] || left) === (aliases[right] || right);
}

function weaknessBonus(weakness: MonsterWeakness | undefined, fighter: MonsterBattleCombatant): number {
  if (!weakness) return 0;
  if (weakness.kind === 'profession') return professionMatches(weakness.profession, fighter.profession) ? weakness.bonus : 0;
  return fighter.damageType === weakness.damageType ? weakness.bonus : 0;
}

function resistanceFor(effect: MonsterPassiveEffect, fighter: MonsterBattleCombatant): number {
  const typeResistance = fighter.damageType === 'magic'
    ? effect.magicResistance
    : fighter.damageType === 'fire'
      ? effect.magicResistance
      : effect.physicalResistance;
  const professionResistance = Object.entries(effect.professionResistance || {})
    .find(([profession]) => professionMatches(profession, fighter.profession))?.[1] || 0;
  return clamp((effect.allResistance || 0) + (typeResistance || 0) + professionResistance, -0.75, 0.85);
}

export function resolveMonsterBattle(input: MonsterBattleInput): MonsterBattleResult {
  const random = input.random || Math.random;
  const maxRounds = Math.floor(clamp(input.maxRounds ?? 30, 1, 100));
  const effect = resolveMonsterPassive(input.monster.passiveDescription || '') || {};
  const weakness = parseMonsterWeakness(input.monster.weakness || '');
  const monsterMaxHp = Math.max(1, safeStat(input.monster.hp, 1));
  let monsterHp = monsterMaxHp;
  let totalDamageToMonster = 0;
  let totalDamageToParty = 0;
  let monsterPoisoned = false;
  let partyAttackReduction = 0;
  let partyDefenseReduction = 0;
  let partySpeedReduction = 0;
  let attackAfterCritical = false;
  const events: MonsterBattleEvent[] = [];
  const party = input.party.map(member => ({
    ...member,
    hp: clamp(safeStat(member.hp), 0, Math.max(1, safeStat(member.maxHp, 1))),
    maxHp: Math.max(1, safeStat(member.maxHp, 1)),
    attack: Math.max(1, safeStat(member.attack, 1)),
    defense: safeStat(member.defense),
    speed: safeStat(member.speed),
    damageDealt: 0,
    damageTaken: 0,
  }));
  if (!party.length || party.every(member => member.hp <= 0)) {
    return { winner: 'monster', rounds: 0, monsterHp, party: party.map(x => ({ ...x, remainingHp: x.hp })), events, totalDamageToMonster, totalDamageToParty, passiveDescription: input.monster.passiveDescription || '' };
  }

  let rounds = 0;
  for (let round = 1; round <= maxRounds && monsterHp > 0 && party.some(member => member.hp > 0); round++) {
    rounds = round;
    const living = party.filter(member => member.hp > 0);
    const monsterHpRatio = monsterHp / monsterMaxHp;
    const monsterAttackMultiplier =
      (effect.attackMultiplier || 1) *
      (effect.attackBelowHpRatio && monsterHpRatio < effect.attackBelowHpRatio.threshold ? effect.attackBelowHpRatio.multiplier : 1) *
      (effect.attackAboveHpRatio && monsterHpRatio > effect.attackAboveHpRatio.threshold ? effect.attackAboveHpRatio.multiplier : 1) *
      (effect.attackAfterRound && round > effect.attackAfterRound.round ? effect.attackAfterRound.multiplier : 1) *
      (round === 1 ? effect.firstAttackMultiplier || 1 : 1) *
      (attackAfterCritical ? 1 + (effect.attackAfterCritical || 0) : 1) *
      (living.length > 1 ? 1 + (effect.attackWhenAllies || 0) : 1);

    const orderedParty = [...living].sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id));
    for (const fighter of orderedParty) {
      if (monsterHp <= 0) break;
      const fighterHpRatio = fighter.hp / fighter.maxHp;
      let attack = fighter.attack * (1 - partyAttackReduction);
      if (effect.attackVsProfession && professionMatches(effect.attackVsProfession.profession, fighter.profession)) {
        // This effect belongs to the monster's attack, not the player's outgoing damage.
      }
      if (effect.attackVsWeakened && (monsterPoisoned || partyAttackReduction > 0 || partyDefenseReduction > 0)) {
        attack *= 1 + effect.attackVsWeakened;
      }
      if (effect.damageVsFastTargets && fighter.speed > safeStat(input.monster.speed)) attack *= 1 + effect.damageVsFastTargets;
      if (effect.damageVsSlowTargets && fighter.speed < safeStat(input.monster.speed)) attack *= 1 + effect.damageVsSlowTargets;
      if (effect.damageVsArmoredTargets && fighter.defense >= safeStat(input.monster.attack)) attack *= 1 + effect.damageVsArmoredTargets;
      if (effect.damageVsLowDefenseTargets && fighter.defense < safeStat(input.monster.attack) * 0.5) attack *= 1 + effect.damageVsLowDefenseTargets;
      if (effect.damageVsLowHpTargets && fighterHpRatio < effect.damageVsLowHpTargets.threshold) attack *= 1 + effect.damageVsLowHpTargets.multiplier - 1;
      if (effect.damageVsProfession && professionMatches(effect.damageVsProfession.profession, fighter.profession)) attack *= effect.damageVsProfession.multiplier;
      if (effect.attackVsProfession && professionMatches(effect.attackVsProfession.profession, fighter.profession)) attack *= effect.attackVsProfession.multiplier;
      if (round === 1 && effect.enemySpeedReductionFirstRound) partySpeedReduction = effect.enemySpeedReductionFirstRound;

      const hitChance = clamp((safeStat(fighter.accuracy, 100) / 100) * (fighter.blind ? (effect.ignoresBlindAccuracyPenalty ? 1 : 0.65) : 1), 0.05, 1);
      if (random() > hitChance) {
        events.push({ round, actor: fighter.id, action: 'miss', target: input.monster.name });
        continue;
      }
      const crit = random() < clamp(safeStat(fighter.critChance), 0, 0.75);
      const critMultiplier = crit
        ? Math.max(1, safeStat(fighter.critMultiplier, 1.5) + (effect.critDamageTaken ? -effect.critDamageTaken : 0))
        : 1;
      const resistance = resistanceFor(effect, fighter);
      const weakness = weaknessBonus(parseMonsterWeakness(input.monster.weakness || ''), fighter);
      const dealt = Math.max(1, Math.floor(damageThroughDefense(attack, safeStat(input.monster.defense) * (effect.defenseMultiplier || 1)) * critMultiplier * (1 - resistance) * (1 + weakness)));
      monsterHp = Math.max(0, monsterHp - dealt);
      fighter.damageDealt += dealt;
      totalDamageToMonster += dealt;
      if (crit && effect.attackAfterCritical) attackAfterCritical = true;
      if (effect.poisonOnHit) monsterPoisoned = true;
      if (effect.enemyDefenseReduction) partyDefenseReduction = clamp(partyDefenseReduction + effect.enemyDefenseReduction, 0, 0.75);
      if (effect.enemyAttackReduction) partyAttackReduction = clamp(partyAttackReduction + effect.enemyAttackReduction, 0, 0.75);
      events.push({ round, actor: fighter.id, action: 'attack', target: input.monster.name, damage: dealt, critical: crit });
    }

    if (monsterHp <= 0) break;
    const targets = party.filter(member => member.hp > 0).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id.localeCompare(b.id));
    const target = targets[0];
    if (!target) break;
    const targetProfessionBonus = effect.damageVsProfession && professionMatches(effect.damageVsProfession.profession, target.profession)
      ? effect.damageVsProfession.multiplier : 1;
    const targetDefense = target.defense * (1 - partyDefenseReduction);
    const incoming = damageThroughDefense(safeStat(input.monster.attack) * monsterAttackMultiplier * targetProfessionBonus, targetDefense);
    const dodgeChance = clamp(effect.evasion || 0, 0, 0.75);
    if (random() < dodgeChance) {
      events.push({ round, actor: input.monster.name, action: 'dodge', target: target.id });
    } else {
      target.hp = Math.max(0, target.hp - incoming);
      target.damageTaken += incoming;
      totalDamageToParty += incoming;
      events.push({ round, actor: input.monster.name, action: 'attack', target: target.id, damage: incoming });
      if (effect.lifesteal) {
        const healed = Math.min(monsterMaxHp - monsterHp, Math.floor(incoming * effect.lifesteal));
        if (healed > 0) {
          monsterHp += healed;
          events.push({ round, actor: input.monster.name, action: 'heal', target: input.monster.name, healing: healed });
        }
      }
    }
    if (effect.healEveryRounds && round % effect.healEveryRounds.rounds === 0) {
      const healed = Math.min(monsterMaxHp - monsterHp, Math.floor(monsterMaxHp * effect.healEveryRounds.maxHpRatio * (1 - (effect.healReduction || 0))));
      if (healed > 0) {
        monsterHp += healed;
        events.push({ round, actor: input.monster.name, action: 'heal', target: input.monster.name, healing: healed });
      }
    }
    if (monsterPoisoned && monsterHp > 0) {
      const poisonDamage = Math.max(1, Math.floor(monsterMaxHp * 0.03));
      monsterHp = Math.max(0, monsterHp - poisonDamage);
      totalDamageToMonster += poisonDamage;
      events.push({ round, actor: 'poison', action: 'poison', target: input.monster.name, damage: poisonDamage });
    }
  }

  const winner = monsterHp <= 0 ? 'party' : party.every(member => member.hp <= 0) ? 'monster' : 'draw';
  return {
    winner, rounds, monsterHp,
    party: party.map(member => ({ ...member, remainingHp: member.hp })),
    events, totalDamageToMonster, totalDamageToParty,
    passiveDescription: input.monster.passiveDescription || '',
  };
}
