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
  buff?: string;
  buffValue?: number;
  buffSecondaryEffect?: string;
  buffSecondaryValue?: number;
  buffUntil?: number;
};

export type MonsterBattleHealingAction = {
  round: number;
  actorId: string;
  targetId: string;
  amount: number;
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
    critChance?: number;
    critMultiplier?: number;
  };
  party: MonsterBattleCombatant[];
  /** Pre-resolved party healing actions; each actor may perform at most one per round. */
  healingActions?: MonsterBattleHealingAction[];
  maxRounds?: number;
  random?: () => number;
  now?: number;
};

export type MonsterBattleEvent = {
  round: number;
  actor: string;
  action: 'attack' | 'miss' | 'dodge' | 'heal' | 'poison' | 'suppress';
  target: string;
  effect?: string;
  value?: number;
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

function resistanceFor(effect: MonsterPassiveEffect, fighter: MonsterBattleCombatant, monsterHpRatio: number): number {
  const typeResistance = fighter.damageType === 'magic'
    ? effect.magicResistance
    : fighter.damageType === 'fire'
      ? effect.magicResistance
      : effect.physicalResistance;
  const professionResistance = Object.entries(effect.professionResistance || {})
    .find(([profession]) => professionMatches(profession, fighter.profession))?.[1] || 0;
  const conditionalResistance = effect.allResistanceAboveHpRatio && monsterHpRatio > effect.allResistanceAboveHpRatio.threshold
    ? effect.allResistanceAboveHpRatio.resistance : 0;
  return clamp((effect.allResistance || 0) + conditionalResistance + (typeResistance || 0) + professionResistance, -0.75, 0.85);
}

export function resolveMonsterBattle(input: MonsterBattleInput): MonsterBattleResult {
  const random = input.random || Math.random;
  const now = input.now ?? Date.now();
  const maxRounds = Math.floor(clamp(input.maxRounds ?? 30, 1, 100));
  const effect = resolveMonsterPassive(input.monster.passiveDescription || '') || {};
  const weakness = parseMonsterWeakness(input.monster.weakness || '');
  const monsterMaxHp = Math.max(1, safeStat(input.monster.hp, 1));
  let monsterHp = monsterMaxHp;
  let totalDamageToMonster = 0;
  let totalDamageToParty = 0;
  const poisonedParty = new Map<string, number>();
  let partyAttackReduction = 0;
  let partyDefenseReduction = 0;
  let partySpeedReduction = 0;
  let attackAfterCritical = false;
  let monsterHasAttacked = false;
  const buffSuppressionApplied = new Set<string>();
  const healingActionsApplied = new Set<string>();
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
    if (round === 1) partySpeedReduction = clamp(effect.enemySpeedReductionFirstRound || 0, 0, 0.95);

    type InitiativeEntry = { kind: 'monster'; speed: number } | { kind: 'party'; speed: number; id: string };
    const initiative: InitiativeEntry[] = [
      ...party.filter(member => member.hp > 0).map(member => ({
        kind: 'party' as const,
        id: member.id,
        speed: member.speed * (1 - (round === 1 ? partySpeedReduction : 0)),
      })),
      { kind: 'monster', speed: safeStat(input.monster.speed) },
    ];
    initiative.sort((a, b) => {
      const speedDifference = b.speed - a.speed;
      if (speedDifference !== 0) return speedDifference;
      if (a.kind !== b.kind) return a.kind === 'monster' ? -1 : 1;
      if (a.kind === 'party' && b.kind === 'party') return a.id.localeCompare(b.id);
      return 0;
    });

    for (const actor of initiative) {
      if (monsterHp <= 0 || !party.some(member => member.hp > 0)) break;

      if (actor.kind === 'party') {
        const fighter = party.find(member => member.id === actor.id);
        if (!fighter || fighter.hp <= 0) continue;

        const healingActionKey = `${round}:${fighter.id}`;
        if (!healingActionsApplied.has(healingActionKey)) {
          const healingAction = (input.healingActions || []).find(action => action.round === round && action.actorId === fighter.id);
          if (healingAction) {
            healingActionsApplied.add(healingActionKey);
            const target = party.find(member => member.id === healingAction.targetId);
            const baseHealing = safeStat(healingAction.amount);
            if (target && target.hp > 0 && baseHealing > 0) {
              const healingMultiplier = 1 - clamp(effect.healReduction || 0, 0, 1);
              const effectiveHealing = Math.floor(baseHealing * healingMultiplier);
              const healed = Math.min(target.maxHp - target.hp, effectiveHealing);
              if (healed > 0) {
                target.hp += healed;
                events.push({ round, actor: fighter.id, action: 'heal', target: target.id, healing: healed });
              }
            }
            // A submitted healing action consumes this actor's turn, even if its target is invalid or full.
            continue;
          }
        }

        const monsterHpRatio = monsterHp / monsterMaxHp;
        const activeAttackBuff = fighter.buff === 'attack' && safeStat(fighter.buffUntil) > now ? safeStat(fighter.buffValue) : 0;
        const activeSecondaryAttackBuff = fighter.buffSecondaryEffect === 'attack' && safeStat(fighter.buffUntil) > now ? safeStat(fighter.buffSecondaryValue) : 0;
        const attack = fighter.attack * (1 + activeAttackBuff + activeSecondaryAttackBuff) * (1 - partyAttackReduction);
        const hitChance = clamp((safeStat(fighter.accuracy, 100) / 100) * (fighter.blind ? (effect.ignoresBlindAccuracyPenalty ? 1 : 0.65) : 1), 0.05, 1);
        if (random() > hitChance) {
          events.push({ round, actor: fighter.id, action: 'miss', target: input.monster.name });
          continue;
        }
        const activeCritBuff = fighter.buff === 'crit' && safeStat(fighter.buffUntil) > now ? safeStat(fighter.buffValue) : 0;
        const activeSecondaryCritBuff = fighter.buffSecondaryEffect === 'crit' && safeStat(fighter.buffUntil) > now ? safeStat(fighter.buffSecondaryValue) : 0;
        const crit = random() < clamp(safeStat(fighter.critChance) + activeCritBuff + activeSecondaryCritBuff, 0, 0.75);
        const critMultiplier = crit
          ? Math.max(1, safeStat(fighter.critMultiplier, 1.5) + (effect.critDamageTaken ? -effect.critDamageTaken : 0))
          : 1;
        const resistance = resistanceFor(effect, fighter, monsterHpRatio);
        const weaknessDamageBonus = weaknessBonus(weakness, fighter);
        const monsterDefenseMultiplier =
          (effect.defenseMultiplier || 1) *
          (safeStat(input.monster.allies) > 0 ? 1 + (effect.defenseWhenAllies || 0) : 1) *
          (effect.defenseBelowHpRatio && monsterHpRatio < effect.defenseBelowHpRatio.threshold ? effect.defenseBelowHpRatio.multiplier : 1);
        const dealt = Math.max(1, Math.floor(
          damageThroughDefense(attack, safeStat(input.monster.defense) * monsterDefenseMultiplier) *
          critMultiplier * (1 - resistance) * (1 + weaknessDamageBonus),
        ));
        monsterHp = Math.max(0, monsterHp - dealt);
        fighter.damageDealt += dealt;
        totalDamageToMonster += dealt;
        events.push({ round, actor: fighter.id, action: 'attack', target: input.monster.name, damage: dealt, critical: crit });
        continue;
      }

      // Monster acts at its actual initiative position, not after the whole party.
      if (monsterHp <= 0) break;
      const targets = party.filter(member => member.hp > 0)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id.localeCompare(b.id));
      const target = targets[0];
      if (!target) break;

      const monsterHpRatio = monsterHp / monsterMaxHp;
      const targetProfessionBonus = effect.damageVsProfession && professionMatches(effect.damageVsProfession.profession, target.profession)
        ? effect.damageVsProfession.multiplier : 1;
      const targetHpRatio = target.hp / target.maxHp;
      const targetIsFast = target.speed * (1 - (round === 1 ? partySpeedReduction : 0)) > safeStat(input.monster.speed);
      const targetIsSlow = target.speed * (1 - (round === 1 ? partySpeedReduction : 0)) < safeStat(input.monster.speed);
      let monsterDamageMultiplier =
        (effect.attackMultiplier || 1) *
        (effect.attackBelowHpRatio && monsterHpRatio < effect.attackBelowHpRatio.threshold ? effect.attackBelowHpRatio.multiplier : 1) *
        (effect.attackAboveHpRatio && monsterHpRatio > effect.attackAboveHpRatio.threshold ? effect.attackAboveHpRatio.multiplier : 1) *
        (effect.attackAfterRound && round > effect.attackAfterRound.round ? effect.attackAfterRound.multiplier : 1) *
        (!monsterHasAttacked ? effect.firstAttackMultiplier || 1 : 1) *
        (attackAfterCritical ? 1 + (effect.attackAfterCritical || 0) : 1) *
        (safeStat(input.monster.allies) > 0 ? 1 + (effect.attackWhenAllies || 0) : 1);
      monsterDamageMultiplier *= targetProfessionBonus;
      if (effect.attackVsProfession && professionMatches(effect.attackVsProfession.profession, target.profession)) monsterDamageMultiplier *= effect.attackVsProfession.multiplier;
      if (effect.damageVsFastTargets && targetIsFast) monsterDamageMultiplier *= 1 + effect.damageVsFastTargets;
      if (effect.damageVsSlowTargets && targetIsSlow) monsterDamageMultiplier *= 1 + effect.damageVsSlowTargets;
      if (effect.damageVsArmoredTargets && target.defense >= safeStat(input.monster.attack)) monsterDamageMultiplier *= 1 + effect.damageVsArmoredTargets;
      if (effect.damageVsLowDefenseTargets && target.defense < safeStat(input.monster.attack) * 0.5) monsterDamageMultiplier *= 1 + effect.damageVsLowDefenseTargets;
      if (effect.damageVsLowHpTargets && targetHpRatio < effect.damageVsLowHpTargets.threshold) monsterDamageMultiplier *= effect.damageVsLowHpTargets.multiplier;
      if (effect.attackVsWeakened && (partyAttackReduction > 0 || partyDefenseReduction > 0 || (round === 1 && partySpeedReduction > 0))) monsterDamageMultiplier *= 1 + effect.attackVsWeakened;

      const activeDefenseBuff = target.buff === 'defense' && safeStat(target.buffUntil) > now ? safeStat(target.buffValue) : 0;
      const activeSecondaryDefenseBuff = target.buffSecondaryEffect === 'defense' && safeStat(target.buffUntil) > now ? safeStat(target.buffSecondaryValue) : 0;
      const targetDefense = target.defense * (1 + activeDefenseBuff + activeSecondaryDefenseBuff) * (1 - partyDefenseReduction);
      const monsterCrit = random() < clamp(safeStat(input.monster.critChance), 0, 0.75);
      const monsterCritMultiplier = monsterCrit
        ? Math.max(1, safeStat(input.monster.critMultiplier, 1.5) + (effect.critDamage || 0))
        : 1;
      const incoming = Math.max(1, Math.floor(
        damageThroughDefense(safeStat(input.monster.attack) * monsterDamageMultiplier, targetDefense) * monsterCritMultiplier,
      ));
      const dodgeChance = clamp(effect.evasion || 0, 0, 0.75);
      const dodged = random() < dodgeChance;
      monsterHasAttacked = true;
      if (dodged) {
        events.push({ round, actor: input.monster.name, action: 'dodge', target: target.id });
      } else {
        target.hp = Math.max(0, target.hp - incoming);
        target.damageTaken += incoming;
        totalDamageToParty += incoming;
        events.push({ round, actor: input.monster.name, action: 'attack', target: target.id, damage: incoming, critical: monsterCrit });
        if (monsterCrit && effect.attackAfterCritical) attackAfterCritical = true;
        if (effect.poisonOnHit && !poisonedParty.has(target.id)) poisonedParty.set(target.id, round);
        if (effect.lifesteal) {
          const healed = Math.min(monsterMaxHp - monsterHp, Math.floor(incoming * effect.lifesteal));
          if (healed > 0) {
            monsterHp += healed;
            events.push({ round, actor: input.monster.name, action: 'heal', target: input.monster.name, healing: healed });
          }
        }
        if (effect.enemyBuffSuppression && !buffSuppressionApplied.has(target.id)) {
          const candidates = [
            { slot: 'primary' as const, effect: target.buff || '', value: safeStat(target.buffValue) },
            { slot: 'secondary' as const, effect: target.buffSecondaryEffect || '', value: safeStat(target.buffSecondaryValue) },
          ].filter(buff => buff.effect && buff.value > 0 && safeStat(target.buffUntil) > now)
            .sort((a, b) => b.value - a.value || (a.slot === 'primary' ? -1 : 1));
          const selected = candidates[0];
          if (selected) {
            const reducedValue = Math.max(0, selected.value * (1 - clamp(effect.enemyBuffSuppression, 0, 1)));
            if (selected.slot === 'primary') target.buffValue = reducedValue;
            else target.buffSecondaryValue = reducedValue;
            buffSuppressionApplied.add(target.id);
            events.push({ round, actor: input.monster.name, action: 'suppress', target: target.id, effect: selected.effect, value: reducedValue });
          }
        }
        if (effect.enemyDefenseReduction) partyDefenseReduction = clamp(partyDefenseReduction + effect.enemyDefenseReduction, 0, 0.75);
        if (effect.enemyAttackReduction) partyAttackReduction = clamp(partyAttackReduction + effect.enemyAttackReduction, 0, 0.75);
      }
    }

    // End-of-round effects resolve only after every surviving actor has had its turn.
    if (monsterHp > 0 && effect.healEveryRounds && round % effect.healEveryRounds.rounds === 0) {
      const healed = Math.min(monsterMaxHp - monsterHp, Math.floor(monsterMaxHp * effect.healEveryRounds.maxHpRatio));
      if (healed > 0) {
        monsterHp += healed;
        events.push({ round, actor: input.monster.name, action: 'heal', target: input.monster.name, healing: healed });
      }
    }
    for (const [poisonedId, appliedRound] of poisonedParty) {
      if (appliedRound >= round) continue;
      const poisonedTarget = party.find(member => member.id === poisonedId);
      if (!poisonedTarget || poisonedTarget.hp <= 0) continue;
      const poisonDamage = Math.max(1, Math.floor(poisonedTarget.maxHp * 0.03));
      poisonedTarget.hp = Math.max(0, poisonedTarget.hp - poisonDamage);
      poisonedTarget.damageTaken += poisonDamage;
      totalDamageToParty += poisonDamage;
      events.push({ round, actor: 'poison', action: 'poison', target: poisonedId, damage: poisonDamage });
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
