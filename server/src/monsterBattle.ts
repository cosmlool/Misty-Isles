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
  /** Typed effects supplied separately from base attack/defense values. */
  combatModifiers?: {
    attackBonus?: number;
    defenseBonus?: number;
    critChanceBonus?: number;
    critChanceMultiplierBonus?: number;
    critDamageBonus?: number;
    lifestealBonus?: number;
    accuracyBonus?: number;
    evasionBonus?: number;
    magicDamageBonus?: number;
    physicalDamageBonus?: number;
    bossDamageBonus?: number;
    resistanceBonus?: number;
    healthBonus?: number;
    attackSpeedBonus?: number;
    healingBonus?: number;
    controlResistance?: number;
  };
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
    accuracy?: number;
    blind?: boolean;
    passiveDescription?: string;
    weakness?: string;
    allies?: number;
    critChance?: number;
    critMultiplier?: number;
    isBoss?: boolean;
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
  const partyAttackReduction = new Map<string, number>();
  const partyDefenseReduction = new Map<string, number>();
  const partySpeedReduction = new Map<string, number>();
  let attackAfterCritical = false;
  let monsterHasAttacked = false;
  const buffSuppressionApplied = new Set<string>();
  const healingActionsApplied = new Set<string>();
  const events: MonsterBattleEvent[] = [];
  const party = input.party.map(member => {
    const baseMaxHp = Math.max(1, safeStat(member.maxHp, 1));
    const baseHp = clamp(safeStat(member.hp), 0, baseMaxHp);
    const modifiers = member.combatModifiers || {};
    const maxHp = Math.max(1, Math.floor(baseMaxHp * (1 + clamp(safeStat(modifiers.healthBonus), 0, 5))));
    const hp = Math.min(maxHp, Math.floor((baseHp / baseMaxHp) * maxHp));
    return {
      ...member,
      hp,
      maxHp,
      attack: Math.max(1, safeStat(member.attack, 1)),
      defense: safeStat(member.defense),
      speed: safeStat(member.speed),
      damageDealt: 0,
      damageTaken: 0,
    };
  });
  if (!party.length || party.every(member => member.hp <= 0)) {
    return { winner: 'monster', rounds: 0, monsterHp, party: party.map(x => ({ ...x, remainingHp: x.hp })), events, totalDamageToMonster, totalDamageToParty, passiveDescription: input.monster.passiveDescription || '' };
  }

  let rounds = 0;
  for (let round = 1; round <= maxRounds && monsterHp > 0 && party.some(member => member.hp > 0); round++) {
    rounds = round;
    if (round === 1 && effect.enemySpeedReductionFirstRound) {
      for (const member of party.filter(member => member.hp > 0)) {
        const resistance = clamp(safeStat(member.combatModifiers?.controlResistance), 0, 0.75);
        if (resistance === 0 || random() >= resistance) {
          partySpeedReduction.set(member.id, clamp(effect.enemySpeedReductionFirstRound, 0, 0.95));
        }
      }
    }

    type InitiativeEntry = { kind: 'monster'; speed: number } | { kind: 'party'; speed: number; id: string };
    const initiative: InitiativeEntry[] = [
      ...party.filter(member => member.hp > 0).map(member => ({
        kind: 'party' as const,
        id: member.id,
        speed: member.speed * (1 + clamp(safeStat(member.combatModifiers?.attackSpeedBonus), 0, 5)) * (1 - (round === 1 ? (partySpeedReduction.get(member.id) || 0) : 0)),
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
              const healingMultiplier = (1 - clamp(effect.healReduction || 0, 0, 1)) * (1 + clamp(safeStat(fighter.combatModifiers?.healingBonus), 0, 5));
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
        const modifiers = fighter.combatModifiers || {};
        const attack = fighter.attack * (1 + activeAttackBuff + activeSecondaryAttackBuff) * (1 + clamp(safeStat(modifiers.attackBonus), 0, 5)) * (1 - (partyAttackReduction.get(fighter.id) || 0));
        const hitChance = clamp(
          (safeStat(fighter.accuracy, 100) / 100) *
          (fighter.blind ? 0.65 : 1),
          0.05,
          1,
        );
        if (random() > hitChance) {
          events.push({ round, actor: fighter.id, action: 'miss', target: input.monster.name });
          continue;
        }
        // Accuracy counters monster evasion in percentage points; it does not
        // inflate an already-capped base hit chance or affect player evasion.
        const monsterEvasionChance = clamp(
          (effect.evasion || 0) - clamp(safeStat(modifiers.accuracyBonus), 0, 0.75),
          0,
          0.75,
        );
        if (monsterEvasionChance > 0 && random() < monsterEvasionChance) {
          events.push({ round, actor: input.monster.name, action: 'dodge', target: fighter.id });
          continue;
        }
        const activeCritBuff = fighter.buff === 'crit' && safeStat(fighter.buffUntil) > now ? safeStat(fighter.buffValue) : 0;
        const activeSecondaryCritBuff = fighter.buffSecondaryEffect === 'crit' && safeStat(fighter.buffUntil) > now ? safeStat(fighter.buffSecondaryValue) : 0;
        const baseCritChance = safeStat(fighter.critChance);
        const critChance = baseCritChance * (1 + clamp(safeStat(modifiers.critChanceMultiplierBonus), 0, 5)) + safeStat(modifiers.critChanceBonus) + activeCritBuff + activeSecondaryCritBuff;
        const crit = random() < clamp(critChance, 0, 0.75);
        const critMultiplier = crit
          ? Math.max(1, safeStat(fighter.critMultiplier, 1.5) + safeStat(modifiers.critDamageBonus) + (effect.critDamageTaken ? -effect.critDamageTaken : 0))
          : 1;
        const resistance = resistanceFor(effect, fighter, monsterHpRatio);
        const weaknessDamageBonus = weaknessBonus(weakness, fighter);
        const monsterDefenseMultiplier =
          (effect.defenseMultiplier || 1) *
          (safeStat(input.monster.allies) > 0 ? 1 + (effect.defenseWhenAllies || 0) : 1) *
          (effect.defenseBelowHpRatio && monsterHpRatio < effect.defenseBelowHpRatio.threshold ? effect.defenseBelowHpRatio.multiplier : 1);
        // Unknown damage type must not silently inherit physical damage bonuses.
        const damageTypeBonus = fighter.damageType === 'magic' || fighter.damageType === 'fire'
          ? safeStat(modifiers.magicDamageBonus)
          : fighter.damageType === 'physical'
            ? safeStat(modifiers.physicalDamageBonus)
            : 0;
        const bossDamageBonus = input.monster.isBoss ? safeStat(modifiers.bossDamageBonus) : 0;
        const dealt = Math.max(1, Math.floor(
          damageThroughDefense(attack, safeStat(input.monster.defense) * monsterDefenseMultiplier) *
          critMultiplier * (1 - resistance) * (1 + weaknessDamageBonus) *
          (1 + clamp(damageTypeBonus, 0, 5)) * (1 + clamp(bossDamageBonus, 0, 5)),
        ));
        monsterHp = Math.max(0, monsterHp - dealt);
        fighter.damageDealt += dealt;
        totalDamageToMonster += dealt;
        events.push({ round, actor: fighter.id, action: 'attack', target: input.monster.name, damage: dealt, critical: crit });
        const lifesteal = clamp(safeStat(modifiers.lifestealBonus), 0, 1);
        const healingBonus = clamp(safeStat(modifiers.healingBonus), 0, 5);
        const healed = Math.min(fighter.maxHp - fighter.hp, Math.floor(dealt * lifesteal * (1 + healingBonus) * (1 - clamp(effect.healReduction || 0, 0, 1))));
        if (healed > 0) {
          fighter.hp += healed;
          events.push({ round, actor: fighter.id, action: 'heal', target: fighter.id, healing: healed });
        }
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
      const targetEffectiveSpeed = target.speed * (1 + clamp(safeStat(target.combatModifiers?.attackSpeedBonus), 0, 5)) * (1 - (round === 1 ? (partySpeedReduction.get(target.id) || 0) : 0));
      const targetIsFast = targetEffectiveSpeed > safeStat(input.monster.speed);
      const targetIsSlow = targetEffectiveSpeed < safeStat(input.monster.speed);
      const bonusAfterCritical = attackAfterCritical;
      attackAfterCritical = false;
      let monsterDamageMultiplier =
        (effect.attackMultiplier || 1) *
        (effect.attackBelowHpRatio && monsterHpRatio < effect.attackBelowHpRatio.threshold ? effect.attackBelowHpRatio.multiplier : 1) *
        (effect.attackAboveHpRatio && monsterHpRatio > effect.attackAboveHpRatio.threshold ? effect.attackAboveHpRatio.multiplier : 1) *
        (effect.attackAfterRound && round > effect.attackAfterRound.round ? effect.attackAfterRound.multiplier : 1) *
        (!monsterHasAttacked ? effect.firstAttackMultiplier || 1 : 1) *
        (bonusAfterCritical ? 1 + (effect.attackAfterCritical || 0) : 1) *
        (safeStat(input.monster.allies) > 0 ? 1 + (effect.attackWhenAllies || 0) : 1);
      monsterDamageMultiplier *= targetProfessionBonus;
      if (effect.attackVsProfession && professionMatches(effect.attackVsProfession.profession, target.profession)) monsterDamageMultiplier *= effect.attackVsProfession.multiplier;
      if (effect.damageVsFastTargets && targetIsFast) monsterDamageMultiplier *= 1 + effect.damageVsFastTargets;
      if (effect.damageVsSlowTargets && targetIsSlow) monsterDamageMultiplier *= 1 + effect.damageVsSlowTargets;
      if (effect.damageVsArmoredTargets && target.defense >= safeStat(input.monster.attack)) monsterDamageMultiplier *= 1 + effect.damageVsArmoredTargets;
      if (effect.damageVsLowDefenseTargets && target.defense < safeStat(input.monster.attack) * 0.5) monsterDamageMultiplier *= 1 + effect.damageVsLowDefenseTargets;
      if (effect.damageVsLowHpTargets && targetHpRatio < effect.damageVsLowHpTargets.threshold) monsterDamageMultiplier *= effect.damageVsLowHpTargets.multiplier;
      if (effect.attackVsWeakened && (target.blind || (partyAttackReduction.get(target.id) || 0) > 0 || (partyDefenseReduction.get(target.id) || 0) > 0 || (round === 1 && (partySpeedReduction.get(target.id) || 0) > 0))) monsterDamageMultiplier *= 1 + effect.attackVsWeakened;

      const monsterHitChance = clamp((safeStat(input.monster.accuracy, 100) / 100) * (input.monster.blind ? (effect.ignoresBlindAccuracyPenalty ? 1 : 0.65) : 1), 0.05, 1);
      monsterHasAttacked = true;
      if (random() > monsterHitChance) {
        events.push({ round, actor: input.monster.name, action: 'miss', target: target.id });
        continue;
      }
      const playerEvasionChance = clamp(safeStat(target.combatModifiers?.evasionBonus), 0, 0.75);
      if (playerEvasionChance > 0 && random() < playerEvasionChance) {
        events.push({ round, actor: input.monster.name, action: 'dodge', target: target.id });
        continue;
      }

      const activeDefenseBuff = target.buff === 'defense' && safeStat(target.buffUntil) > now ? safeStat(target.buffValue) : 0;
      const activeSecondaryDefenseBuff = target.buffSecondaryEffect === 'defense' && safeStat(target.buffUntil) > now ? safeStat(target.buffSecondaryValue) : 0;
      const targetModifiers = target.combatModifiers || {};
      const targetDefense = target.defense * (1 + activeDefenseBuff + activeSecondaryDefenseBuff) * (1 + clamp(safeStat(targetModifiers.defenseBonus), 0, 5)) * (1 - (partyDefenseReduction.get(target.id) || 0));
      const monsterCrit = random() < clamp(safeStat(input.monster.critChance), 0, 0.75);
      const monsterCritMultiplier = monsterCrit
        ? Math.max(1, safeStat(input.monster.critMultiplier, 1.5) + (effect.critDamage || 0))
        : 1;
      const incoming = Math.max(1, Math.floor(
        damageThroughDefense(safeStat(input.monster.attack) * monsterDamageMultiplier, targetDefense) * monsterCritMultiplier *
        (1 - clamp(safeStat(targetModifiers.resistanceBonus), 0, 0.75)),
      ));
      {
        target.hp = Math.max(0, target.hp - incoming);
        target.damageTaken += incoming;
        totalDamageToParty += incoming;
        events.push({ round, actor: input.monster.name, action: 'attack', target: target.id, damage: incoming, critical: monsterCrit });
        if (monsterCrit && effect.attackAfterCritical) attackAfterCritical = true;
        if (effect.poisonOnHit && !poisonedParty.has(target.id)) {
          const controlResistance = clamp(safeStat(target.combatModifiers?.controlResistance), 0, 0.75);
          if (controlResistance === 0 || random() >= controlResistance) poisonedParty.set(target.id, round);
        }
        if (effect.lifesteal) {
          const healed = Math.min(monsterMaxHp - monsterHp, Math.floor(incoming * effect.lifesteal));
          if (healed > 0) {
            monsterHp += healed;
            events.push({ round, actor: input.monster.name, action: 'heal', target: input.monster.name, healing: healed });
          }
        }
        if (effect.enemyBuffSuppression && !buffSuppressionApplied.has(target.id)) {
          const controlResistance = clamp(safeStat(targetModifiers.controlResistance), 0, 0.75);
          const resistsBuffSuppression = controlResistance > 0 && random() < controlResistance;
          const candidates = resistsBuffSuppression ? [] : [
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
        if (effect.enemyDefenseReduction) {
          const resistance = clamp(safeStat(targetModifiers.controlResistance), 0, 0.75);
          if (resistance === 0 || random() >= resistance) partyDefenseReduction.set(target.id, clamp((partyDefenseReduction.get(target.id) || 0) + effect.enemyDefenseReduction, 0, 0.75));
        }
        if (effect.enemyAttackReduction) {
          const resistance = clamp(safeStat(targetModifiers.controlResistance), 0, 0.75);
          if (resistance === 0 || random() >= resistance) partyAttackReduction.set(target.id, clamp((partyAttackReduction.get(target.id) || 0) + effect.enemyAttackReduction, 0, 0.75));
        }
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
/** Initiative speed is derived from base dexterity plus explicit equipment dexterity bonuses. */
export function calculateCombatSpeed(dexterity: number, equipmentDexterityBonus = 0): number {
  const base = Number.isFinite(dexterity) ? Math.max(0, dexterity) : 0;
  const equipmentBonus = Number.isFinite(equipmentDexterityBonus) ? Math.max(0, equipmentDexterityBonus) : 0;
  return base + equipmentBonus;
}
