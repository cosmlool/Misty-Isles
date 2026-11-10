import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { getMonsterPassiveDescriptions, parseMonsterWeakness, resolveMonsterPassive } from '../src/monsterCombat.js';
import { calculateCombatSpeed, resolveMonsterBattle } from '../src/monsterBattle.js';
import { adaptPlayerCombatant } from '../src/monsterCombatantAdapter.js';
import { calculatePlayerMonsterCombatStats, parseMonsterCombatEffect } from '../src/monsterCombatStats.js';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bestiary = JSON.parse(readFileSync(resolve(serverDir, 'data/forgotten_lands.json'), 'utf8'));

test('every bestiary passive description has one typed registry entry', () => {
  const descriptions = [...new Set(bestiary.monsters.map((monster: any) => monster.passiveDescription))];
  const registered = new Set(getMonsterPassiveDescriptions());
  assert.equal(descriptions.length, 63);
  assert.equal(registered.size, descriptions.length);
  for (const description of descriptions) {
    assert.ok(registered.has(description), `Missing passive mapping: ${description}`);
    assert.ok(resolveMonsterPassive(description), `Passive has no typed effect: ${description}`);
  }
});

test('monster weakness parser distinguishes professions from damage types', () => {
  assert.deepEqual(parseMonsterWeakness('Маг +25%'), { kind: 'profession', profession: 'Маг', bonus: 0.25 });
  assert.deepEqual(parseMonsterWeakness('Лучник +10%'), { kind: 'profession', profession: 'Лучник', bonus: 0.10 });
  assert.deepEqual(parseMonsterWeakness('Огненный урон +25%'), { kind: 'damageType', damageType: 'fire', bonus: 0.25 });
  assert.equal(parseMonsterWeakness('нет'), undefined);
  assert.equal(parseMonsterWeakness('Маг +x%'), undefined);
  assert.equal(parseMonsterWeakness('Лёд +25%'), undefined);
});

test('passive registry keeps compound effects instead of dropping secondary clauses', () => {
  assert.deepEqual(resolveMonsterPassive('Весь урон −20%; ниже 50% HP атака +20%'), {
    allResistance: 0.20,
    attackBelowHpRatio: { threshold: 0.50, multiplier: 1.20 },
  });
  assert.deepEqual(resolveMonsterPassive('Восстанавливает 10% HP каждый третий раунд; урон лучника −20%'), {
    healEveryRounds: { rounds: 3, maxHpRatio: 0.10 },
    professionResistance: { 'Лучник': 0.20 },
  });
});


test('monster battle resolves profession and fire weaknesses deterministically', () => {
  const base = {
    monster: { id: 'm1', name: 'Test monster', hp: 50, attack: 1, defense: 0, speed: 5, weakness: 'Огненный урон +25%' },
    party: [{ id: 'p1', profession: 'Боевой маг', hp: 500, maxHp: 500, attack: 100, defense: 0, speed: 10, damageType: 'fire' as const }],
    random: () => 0.5,
  };
  const first = resolveMonsterBattle(base);
  const second = resolveMonsterBattle(base);
  assert.equal(first.winner, 'party');
  assert.equal(first.totalDamageToMonster, 125);
  assert.deepEqual(first, second);
});

test('monster profession damage bonus affects incoming damage, not player outgoing damage', () => {
  const run = (profession: string) => resolveMonsterBattle({
    monster: { id: 'm2', name: 'Archer hunter', hp: 10000, attack: 100, defense: 0, speed: 5, passiveDescription: 'Урон по лучникам +20%' },
    party: [{ id: 'p2', profession, hp: 1000, maxHp: 1000, attack: 10, defense: 0, speed: 5 }],
    random: () => 0.5,
  });
  const archer = run('Лучник');
  const warrior = run('Воин');
  assert.equal(archer.totalDamageToMonster, warrior.totalDamageToMonster);
  assert.equal(archer.totalDamageToParty, 120);
  assert.equal(warrior.totalDamageToParty, 100);
});


test('monster ally bonuses depend on monster allies, not party size', () => {
  const run = (allies: number) => resolveMonsterBattle({
    monster: { id: 'm3', name: 'Pack hunter', hp: 10000, attack: 100, defense: 0, speed: 5, allies, passiveDescription: 'Атака +10% при союзниках' },
    party: [{ id: 'p3', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 10, defense: 0, speed: 5 }],
    random: () => 0.5,
  });
  assert.equal(run(0).totalDamageToParty, 100);
  assert.equal(run(1).totalDamageToParty, 110);
});

test('monster defense ally bonus applies to incoming player damage', () => {
  const run = (allies: number) => resolveMonsterBattle({
    monster: { id: 'm4', name: 'Guarded monster', hp: 10000, attack: 1, defense: 100, speed: 5, allies, passiveDescription: 'Атака и защита +15% при союзниках' },
    party: [{ id: 'p4', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 100, defense: 0, speed: 5 }],
    random: () => 0.5,
  });
  assert.equal(run(0).totalDamageToMonster, 50);
  assert.equal(run(1).totalDamageToMonster, 46);
});


test('monster poison is applied to the struck player and ticks on following rounds', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm5', name: 'Venom beast', hp: 10000, attack: 10, defense: 0, speed: 5, passiveDescription: 'Атака накладывает яд' },
    party: [{ id: 'p5', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 5 }],
    maxRounds: 2,
    random: () => 0.5,
  });
  assert.equal(result.totalDamageToMonster, 2);
  assert.equal(result.totalDamageToParty, 50);
  assert.ok(result.events.some(event => event.action === 'poison' && event.target === 'p5' && event.damage === 30));
});

test('faster player can kill the monster before its initiative turn', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-fast-kill', name: 'Slow monster', hp: 10, attack: 100, defense: 0, speed: 5 },
    party: [{ id: 'p-fast', profession: 'Воин', hp: 500, maxHp: 500, attack: 20, defense: 0, speed: 20 }],
    random: () => 0.5,
  });
  assert.equal(result.winner, 'party');
  assert.equal(result.totalDamageToParty, 0);
  assert.equal(result.events.some(event => event.actor === 'Slow monster'), false);
});

test('faster monster attacks before the player turn', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-fast', name: 'Fast monster', hp: 10000, attack: 100, defense: 0, speed: 20 },
    party: [{ id: 'p-slow', profession: 'Воин', hp: 50, maxHp: 50, attack: 100, defense: 0, speed: 10 }],
    random: () => 0.5,
  });
  assert.equal(result.winner, 'monster');
  assert.equal(result.totalDamageToMonster, 0);
  assert.equal(result.events[0]?.actor, 'Fast monster');
});

test('first-round enemy speed reduction can change initiative order', () => {
  const make = (passiveDescription?: string) => resolveMonsterBattle({
    monster: { id: 'm-speed-check', name: 'Speed check', hp: 10000, attack: 1, defense: 0, speed: 10, passiveDescription },
    party: [{ id: 'p-speed-check', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 11 }],
    random: () => 0.5,
  });
  assert.equal(make().events[0]?.actor, 'p-speed-check');
  assert.equal(make('Снижает скорость противника на 20% в первом раунде').events[0]?.actor, 'Speed check');
});

test('equal-speed initiative uses a stable monster-first tie-break', () => {
  const input = {
    monster: { id: 'm-tie', name: 'Tie monster', hp: 10000, attack: 1, defense: 0, speed: 10 },
    party: [
      { id: 'p-z', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 },
      { id: 'p-a', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 },
    ],
    random: () => 0.5,
  };
  const first = resolveMonsterBattle(input);
  const second = resolveMonsterBattle(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first.events.slice(0, 3).map(event => event.actor), ['Tie monster', 'p-a', 'p-z']);
});

test('monster resistance above half HP ends when the monster drops below the threshold', () => {
  const result = resolveMonsterBattle({
    monster: {
      id: 'm-conditional-resist',
      name: 'Threshold guardian',
      hp: 100,
      attack: 1,
      defense: 0,
      speed: 1,
      passiveDescription: 'Весь урон −20% пока HP выше 50%',
    },
    party: [
      { id: 'p-first', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 70, defense: 0, speed: 20 },
      { id: 'p-second', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 10, defense: 0, speed: 19 },
    ],
    random: () => 0.5,
  });
  assert.deepEqual(result.events.filter(event => event.action === 'attack' && event.target === 'Threshold guardian').map(event => event.damage), [56, 10]);
});

test('monster suppresses one strongest active buff once per target', () => {
  const result = resolveMonsterBattle({
    monster: {
      id: 'm-suppress',
      name: 'Hexing monster',
      hp: 10000,
      attack: 1,
      defense: 0,
      speed: 20,
      passiveDescription: 'Снижает силу одного усиления противника на 10%',
    },
    party: [{
      id: 'p-buffed',
      profession: 'Воин',
      hp: 1000,
      maxHp: 1000,
      attack: 100,
      defense: 0,
      speed: 10,
      buff: 'attack',
      buffValue: 0.20,
      buffSecondaryEffect: 'defense',
      buffSecondaryValue: 0.10,
      buffUntil: 10000,
    }],
    now: 1000,
    maxRounds: 2,
    random: () => 0.5,
  });
  assert.equal(result.party[0]?.buffValue, 0.18);
  assert.equal(result.party[0]?.buffSecondaryValue, 0.10);
  assert.equal(result.totalDamageToMonster, 236);
  assert.equal(result.events.filter(event => event.action === 'suppress').length, 1);
  assert.deepEqual(
    result.events.filter(event => event.action === 'suppress').map(event => ({ effect: event.effect, value: event.value })),
    [{ effect: 'attack', value: 0.18 }],
  );
});

test('expired buffs are not suppressed or applied to combat stats', () => {
  const result = resolveMonsterBattle({
    monster: {
      id: 'm-expired',
      name: 'Buff hunter',
      hp: 10000,
      attack: 1,
      defense: 0,
      speed: 20,
      passiveDescription: 'Снижает силу одного усиления противника на 10%',
    },
    party: [{
      id: 'p-expired',
      profession: 'Воин',
      hp: 1000,
      maxHp: 1000,
      attack: 100,
      defense: 0,
      speed: 10,
      buff: 'attack',
      buffValue: 0.20,
      buffUntil: 999,
    }],
    now: 1000,
    random: () => 0.5,
  });
  assert.equal(result.totalDamageToMonster, 3000);
  assert.equal(result.party[0]?.buffValue, 0.20);
  assert.equal(result.events.some(event => event.action === 'suppress'), false);
});



test('party healing actions restore the full requested amount without heal reduction', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-heal-full', name: 'Training monster', hp: 10000, attack: 1, defense: 0, speed: 1 },
    party: [
      { id: 'healer', profession: 'Баффер', hp: 100, maxHp: 100, attack: 1, defense: 0, speed: 20 },
      { id: 'wounded', profession: 'Воин', hp: 50, maxHp: 100, attack: 1, defense: 0, speed: 10 },
    ],
    healingActions: [{ round: 1, actorId: 'healer', targetId: 'wounded', amount: 40 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.deepEqual(result.events.filter(event => event.action === 'heal').map(event => event.healing), [40]);
});

test('monster heal reduction lowers party healing by ten percent', () => {
  const result = resolveMonsterBattle({
    monster: {
      id: 'm-heal-reduction',
      name: 'Healing ward monster',
      hp: 10000,
      attack: 1,
      defense: 0,
      speed: 1,
      passiveDescription: 'Лечение противника −10%',
    },
    party: [
      { id: 'healer', profession: 'Баффер', hp: 100, maxHp: 100, attack: 1, defense: 0, speed: 20 },
      { id: 'wounded', profession: 'Воин', hp: 50, maxHp: 100, attack: 1, defense: 0, speed: 10 },
    ],
    healingActions: [{ round: 1, actorId: 'healer', targetId: 'wounded', amount: 40 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.deepEqual(result.events.filter(event => event.action === 'heal').map(event => event.healing), [36]);
});

test('party healing never restores health above the target max HP', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-heal-cap', name: 'Training monster', hp: 10000, attack: 1, defense: 0, speed: 1 },
    party: [
      { id: 'healer', profession: 'Баффер', hp: 100, maxHp: 100, attack: 1, defense: 0, speed: 20 },
      { id: 'almost-full', profession: 'Воин', hp: 90, maxHp: 100, attack: 1, defense: 0, speed: 10 },
    ],
    healingActions: [{ round: 1, actorId: 'healer', targetId: 'almost-full', amount: 50 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.events.find(event => event.action === 'heal')?.healing, 10);
  assert.equal(result.party.find(member => member.id === 'almost-full')?.remainingHp, 99);
});

test('party healing ignores dead and unknown targets', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-heal-invalid', name: 'Training monster', hp: 10000, attack: 1, defense: 0, speed: 1 },
    party: [
      { id: 'healer-a', profession: 'Баффер', hp: 100, maxHp: 100, attack: 1, defense: 0, speed: 30 },
      { id: 'healer-b', profession: 'Баффер', hp: 100, maxHp: 100, attack: 1, defense: 0, speed: 20 },
      { id: 'dead', profession: 'Воин', hp: 0, maxHp: 100, attack: 1, defense: 0, speed: 10 },
    ],
    healingActions: [
      { round: 1, actorId: 'healer-a', targetId: 'dead', amount: 50 },
      { round: 1, actorId: 'healer-b', targetId: 'missing', amount: 50 },
    ],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.party.find(member => member.id === 'dead')?.remainingHp, 0);
  assert.equal(result.events.some(event => event.action === 'heal'), false);
});

test('monster periodic healing remains independent from party healing actions', () => {
  const result = resolveMonsterBattle({
    monster: {
      id: 'm-own-heal',
      name: 'Regenerating monster',
      hp: 100,
      attack: 1,
      defense: 0,
      speed: 1,
      passiveDescription: 'Восстанавливает 8% HP каждый второй раунд',
    },
    party: [{ id: 'fighter', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 20 }],
    healingActions: [{ round: 1, actorId: 'fighter', targetId: 'fighter', amount: 20 }],
    maxRounds: 2,
    random: () => 0.5,
  });
  assert.ok(result.events.some(event => event.actor === 'Regenerating monster' && event.target === 'Regenerating monster' && event.healing === 8));
});


test('a party healing action consumes the actor turn instead of also attacking', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-heal-turn', name: 'Training monster', hp: 10000, attack: 1, defense: 0, speed: 1 },
    party: [{ id: 'healer', profession: 'Баффер', hp: 50, maxHp: 100, attack: 100, defense: 0, speed: 20 }],
    healingActions: [{ round: 1, actorId: 'healer', targetId: 'healer', amount: 20 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.totalDamageToMonster, 0);
  assert.equal(result.events.some(event => event.actor === 'healer' && event.action === 'attack'), false);
  assert.equal(result.events.find(event => event.actor === 'healer' && event.action === 'heal')?.healing, 20);
});


test('monster defense reduction is scoped to the struck party member', () => {
  const result = resolveMonsterBattle({
    monster: {
      id: 'm-target-defense',
      name: 'Defense breaker',
      hp: 10000,
      attack: 100,
      defense: 0,
      speed: 20,
      passiveDescription: 'Снижает защиту цели на 10%',
    },
    party: [
      { id: 'a-target', profession: 'Воин', hp: 900, maxHp: 1000, attack: 1, defense: 100, speed: 10 },
      { id: 'b-other', profession: 'Воин', hp: 950, maxHp: 1000, attack: 1, defense: 100, speed: 9 },
      { id: 'healer', profession: 'Баффер', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 15 },
    ],
    healingActions: [{ round: 1, actorId: 'healer', targetId: 'a-target', amount: 200 }],
    maxRounds: 2,
    random: () => 0.5,
  });
  assert.equal(result.party.find(member => member.id === 'a-target')?.damageTaken, 50);
  assert.equal(result.party.find(member => member.id === 'b-other')?.damageTaken, 50);
});

test('monster attack reduction is scoped to the struck party member', () => {
  const result = resolveMonsterBattle({
    monster: {
      id: 'm-target-attack',
      name: 'Attack breaker',
      hp: 10000,
      attack: 1,
      defense: 0,
      speed: 20,
      passiveDescription: 'Атака противника −10%',
    },
    party: [
      { id: 'a-target', profession: 'Воин', hp: 900, maxHp: 1000, attack: 100, defense: 0, speed: 10 },
      { id: 'b-other', profession: 'Воин', hp: 950, maxHp: 1000, attack: 100, defense: 0, speed: 9 },
      { id: 'healer', profession: 'Баффер', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 15 },
    ],
    healingActions: [{ round: 1, actorId: 'healer', targetId: 'a-target', amount: 200 }],
    maxRounds: 2,
    random: () => 0.5,
  });
  assert.equal(result.party.find(member => member.id === 'a-target')?.damageDealt, 180);
  assert.equal(result.party.find(member => member.id === 'b-other')?.damageDealt, 190);
});


test('monster deals bonus damage to a blinded weakened target', () => {
  const run = (blind: boolean) => resolveMonsterBattle({
    monster: {
      id: 'm-weakened-target',
      name: 'Weakness hunter',
      hp: 10000,
      attack: 100,
      defense: 0,
      speed: 20,
      passiveDescription: 'Атака +15% против ослабленной цели',
    },
    party: [{ id: 'target', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10, blind }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(run(true).totalDamageToParty, 115);
  assert.equal(run(false).totalDamageToParty, 100);
});


test('blindness immunity protects monster accuracy, not player accuracy', () => {
  const monsterBlindWithoutImmunity = resolveMonsterBattle({
    monster: { id: 'm-blind', name: 'Blinded monster', hp: 10000, attack: 100, defense: 0, speed: 20, accuracy: 100, blind: true },
    party: [{ id: 'p-clear', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 1,
    random: () => 0.8,
  });
  const monsterBlindWithImmunity = resolveMonsterBattle({
    monster: {
      id: 'm-blind-immune',
      name: 'Blindness-proof monster',
      hp: 10000,
      attack: 100,
      defense: 0,
      speed: 20,
      accuracy: 100,
      blind: true,
      passiveDescription: 'Не теряет точность от ослепления',
    },
    party: [{ id: 'p-clear', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 1,
    random: () => 0.8,
  });
  const blindedPlayerAgainstImmuneMonster = resolveMonsterBattle({
    monster: {
      id: 'm-no-blind',
      name: 'Unblinded monster',
      hp: 10000,
      attack: 100,
      defense: 0,
      speed: 20,
      accuracy: 100,
      passiveDescription: 'Не теряет точность от ослепления',
    },
    party: [{ id: 'p-blind', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10, blind: true }],
    maxRounds: 1,
    random: () => 0.8,
  });

  assert.equal(monsterBlindWithoutImmunity.totalDamageToParty, 0);
  assert.equal(monsterBlindWithImmunity.totalDamageToParty, 100);
  assert.equal(blindedPlayerAgainstImmuneMonster.totalDamageToParty, 100);
  assert.ok(blindedPlayerAgainstImmuneMonster.events.some(event => event.actor === 'p-blind' && event.action === 'miss'));
});


test('every weakness value used by the bestiary is supported by the parser', () => {
  const weaknesses = [...new Set(bestiary.monsters.map((monster: any) => monster.weakness).filter(Boolean))];
  assert.ok(weaknesses.length > 0);
  for (const weakness of weaknesses) {
    assert.ok(parseMonsterWeakness(weakness), `Unsupported bestiary weakness: ${weakness}`);
  }
});


test('first attack bonus applies once and then returns to normal damage', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-first-hit', name: 'First striker', hp: 10000, attack: 100, defense: 0, speed: 20, passiveDescription: 'Первая атака +20%' },
    party: [{ id: 'p-first-hit', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 2,
    random: () => 0.5,
  });
  assert.deepEqual(result.events.filter(event => event.actor === 'First striker' && event.action === 'attack').map(event => event.damage), [120, 100]);
});

test('attack after first round bonus starts on round two', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-after-round', name: 'Scaling striker', hp: 10000, attack: 100, defense: 0, speed: 20, passiveDescription: 'Атака +15% после первого раунда' },
    party: [{ id: 'p-after-round', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 2,
    random: () => 0.5,
  });
  assert.deepEqual(result.events.filter(event => event.actor === 'Scaling striker' && event.action === 'attack').map(event => event.damage), [100, 115]);
});

test('low-health attack bonus activates only below its HP threshold', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-low-hp', name: 'Desperate striker', hp: 100, attack: 100, defense: 0, speed: 10, passiveDescription: 'Атака +20% ниже 50% HP' },
    party: [{ id: 'p-low-hp', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 60, defense: 0, speed: 20 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.monsterHp, 40);
  assert.equal(result.events.find(event => event.actor === 'Desperate striker' && event.action === 'attack')?.damage, 120);
});

test('evasion passive can completely avoid a monster hit', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-evasion', name: 'Dodged attacker', hp: 10000, attack: 100, defense: 0, speed: 20, passiveDescription: 'Уклонение +15%' },
    party: [{ id: 'p-evasion', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 1,
    random: () => 0.1,
  });
  assert.equal(result.totalDamageToParty, 0);
  assert.ok(result.events.some(event => event.actor === 'Dodged attacker' && event.action === 'dodge'));
});

test('monster lifesteal restores a percentage of damage actually dealt', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-lifesteal', name: 'Leech monster', hp: 1000, attack: 100, defense: 0, speed: 10, passiveDescription: 'Восстанавливает 10% нанесённого урона' },
    party: [{ id: 'p-lifesteal', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 500, defense: 0, speed: 20 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.monsterHp, 510);
  assert.ok(result.events.some(event => event.actor === 'Leech monster' && event.action === 'heal' && event.healing === 10));
});

test('monster critical damage bonus increases only critical hits', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-crit-bonus', name: 'Critical striker', hp: 10000, attack: 100, defense: 0, speed: 20, critChance: 1, critMultiplier: 1.5, passiveDescription: 'Критический урон +10%' },
    party: [{ id: 'p-crit-bonus', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.totalDamageToParty, 160);
  assert.equal(result.events.find(event => event.actor === 'Critical striker' && event.action === 'attack')?.critical, true);
});

test('monster critical damage reduction lowers party critical multiplier', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-crit-reduce', name: 'Critical ward', hp: 10000, attack: 1, defense: 0, speed: 10, passiveDescription: 'Критический урон −20%' },
    party: [{ id: 'p-crit-reduce', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 100, defense: 0, speed: 20, critChance: 1, critMultiplier: 1.5 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.totalDamageToMonster, 130);
  assert.equal(result.events.find(event => event.actor === 'p-crit-reduce' && event.action === 'attack')?.critical, true);
});

test('attack bonus after a monster critical hit is consumed by the next attack only', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-after-crit', name: 'Critical chain', hp: 10000, attack: 100, defense: 0, speed: 20, critChance: 0.5, critMultiplier: 1, passiveDescription: 'После критического удара атака +15%' },
    party: [{ id: 'p-after-crit', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 3,
    random: (() => { const values = [0.5, 0.1, 0.5, 0.5, 0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5, 0.9, 0.5, 0.5]; let index = 0; return () => values[index++] ?? 0.5; })(),
  });
  assert.deepEqual(result.events.filter(event => event.actor === 'Critical chain' && event.action === 'attack').map(event => event.damage), [100, 115, 100]);
});


test('physical, magic and fire resistance use the matching incoming damage type', () => {
  const run = (passiveDescription: string, damageType: 'physical' | 'magic' | 'fire') => resolveMonsterBattle({
    monster: { id: 'm-resistance-matrix', name: 'Resistance tester', hp: 10000, attack: 100, defense: 0, speed: 20, passiveDescription },
    party: [{ id: `p-${damageType}`, profession: 'Воин', hp: 1000, maxHp: 1000, attack: 100, defense: 0, speed: 10, damageType }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(run('На 20% меньше физического урона', 'physical').totalDamageToMonster, 80);
  assert.equal(run('Магический урон −15%', 'magic').totalDamageToMonster, 85);
  assert.equal(run('Магический урон −15%', 'fire').totalDamageToMonster, 85);
});

test('negative magic resistance increases incoming magic damage', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-magic-vulnerable', name: 'Magic vulnerable', hp: 10000, attack: 100, defense: 0, speed: 20, passiveDescription: 'Получает на 20% больше магического урона' },
    party: [{ id: 'p-magic', profession: 'Боевой маг', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10, damageType: 'magic' }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.totalDamageToMonster, 120);
});


test('damage bonuses against fast and slow targets use initiative-adjusted speed', () => {
  const run = (playerSpeed: number, passiveDescription: string) => resolveMonsterBattle({
    monster: { id: 'm-speed-target', name: 'Speed hunter', hp: 10000, attack: 100, defense: 0, speed: 10, passiveDescription },
    party: [{ id: 'p-speed-target', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: playerSpeed }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(run(20, 'Урон +20% по быстрым целям').totalDamageToParty, 120);
  assert.equal(run(5, 'Урон +20% по медленным целям').totalDamageToParty, 120);
  assert.equal(run(5, 'Урон +20% по быстрым целям').totalDamageToParty, 100);
  assert.equal(run(20, 'Урон +20% по медленным целям').totalDamageToParty, 100);
});

test('damage bonus against armored targets checks the target defense threshold', () => {
  const run = (passiveDescription?: string) => resolveMonsterBattle({
    monster: { id: 'm-armored', name: 'Armor hunter', hp: 10000, attack: 100, defense: 0, speed: 20, passiveDescription },
    party: [{ id: 'p-armored', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 100, speed: 10 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(run().totalDamageToParty, 50);
  assert.equal(run('Урон +20% по защищённым целям').totalDamageToParty, 60);
});

test('damage bonus against low-defense targets checks the target defense threshold', () => {
  const run = (passiveDescription?: string) => resolveMonsterBattle({
    monster: { id: 'm-low-defense', name: 'Defense hunter', hp: 10000, attack: 100, defense: 0, speed: 20, passiveDescription },
    party: [{ id: 'p-low-defense', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 40, speed: 10 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(run().totalDamageToParty, 71);
  assert.equal(run('Урон +20% по целям с низкой защитой').totalDamageToParty, 85);
});

test('damage bonus against low-HP targets activates below its threshold', () => {
  const run = (hp: number, passiveDescription?: string) => resolveMonsterBattle({
    monster: { id: 'm-low-target-hp', name: 'Finisher', hp: 10000, attack: 100, defense: 0, speed: 20, passiveDescription },
    party: [{ id: 'p-low-target-hp', profession: 'Воин', hp, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(run(400, 'Урон +25% по целям ниже 30% HP').totalDamageToParty, 100);
  assert.equal(run(200, 'Урон +25% по целям ниже 30% HP').totalDamageToParty, 125);
});

test('attack bonus against a profession affects only the matching target profession', () => {
  const run = (profession: string) => resolveMonsterBattle({
    monster: { id: 'm-vs-profession', name: 'Mage hunter', hp: 10000, attack: 100, defense: 0, speed: 20, passiveDescription: 'Атака +15% против мага' },
    party: [{ id: 'p-vs-profession', profession, hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(run('Боевой маг').totalDamageToParty, 115);
  assert.equal(run('Воин').totalDamageToParty, 100);
});

test('damage bonus against a profession affects incoming damage only for that profession', () => {
  const run = (profession: string) => resolveMonsterBattle({
    monster: { id: 'm-damage-profession', name: 'Archer hunter', hp: 10000, attack: 100, defense: 0, speed: 20, passiveDescription: 'Урон по лучникам +20%' },
    party: [{ id: 'p-damage-profession', profession, hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(run('Лучник').totalDamageToParty, 120);
  assert.equal(run('Воин').totalDamageToParty, 100);
});

test('monster defense bonus activates below its low-HP threshold', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-defense-low-hp', name: 'Last stand', hp: 100, attack: 100, defense: 100, speed: 10, passiveDescription: 'Защита +25% ниже 25% HP' },
    party: [{ id: 'p-defense-low-hp', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 160, defense: 0, speed: 20 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.monsterHp, 20);
  assert.equal(result.totalDamageToParty, 44);
});

test('compound passive applies attack, defense and physical resistance together', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-compound', name: 'Iron guardian', hp: 10000, attack: 100, defense: 100, speed: 20, passiveDescription: 'Атака и защита +15%; физический урон −25%' },
    party: [{ id: 'p-compound', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 100, defense: 0, speed: 10, damageType: 'physical' }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.totalDamageToMonster, 34);
  assert.equal(result.totalDamageToParty, 115);
});

test('HP-threshold passives do not activate at the exact threshold', () => {
  const belowThreshold = resolveMonsterBattle({
    monster: { id: 'm-threshold-50', name: 'Threshold guardian', hp: 1000, attack: 100, defense: 0, speed: 10, passiveDescription: 'Атака +20% ниже 50% HP' },
    party: [{ id: 'p-threshold-50', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 500, defense: 0, speed: 20 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  const aboveThreshold = resolveMonsterBattle({
    monster: { id: 'm-threshold-75', name: 'Threshold sentinel', hp: 1000, attack: 100, defense: 0, speed: 10, passiveDescription: 'Атака +10% при HP выше 75%' },
    party: [{ id: 'p-threshold-75', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 250, defense: 0, speed: 20 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(belowThreshold.monsterHp, 500);
  assert.equal(belowThreshold.totalDamageToParty, 100);
  assert.equal(aboveThreshold.monsterHp, 750);
  assert.equal(aboveThreshold.totalDamageToParty, 100);
});

test('equal initiative speed is neither a fast nor a slow target', () => {
  const run = (passiveDescription: string) => resolveMonsterBattle({
    monster: { id: 'm-equal-speed', name: 'Equal-speed hunter', hp: 10000, attack: 100, defense: 0, speed: 10, passiveDescription },
    party: [{ id: 'p-equal-speed', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 10 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(run('Урон +20% по быстрым целям').totalDamageToParty, 100);
  assert.equal(run('Урон +20% по медленным целям').totalDamageToParty, 100);
});

test('zero player critical chance never produces a critical hit', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-zero-crit', name: 'Crit tester', hp: 10000, attack: 1, defense: 0, speed: 10 },
    party: [{ id: 'p-zero-crit', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 100, defense: 0, speed: 20, critChance: 0, critMultiplier: 2 }],
    maxRounds: 1,
    random: () => 0,
  });
  const attack = result.events.find(event => event.actor === 'p-zero-crit' && event.action === 'attack');
  assert.equal(attack?.critical, false);
  assert.equal(attack?.damage, 100);
});

test('damage formula preserves minimum one damage against extreme defense', () => {
  const result = resolveMonsterBattle({
    monster: { id: 'm-extreme-defense', name: 'Immovable target', hp: 10000, attack: 1, defense: 1_000_000_000, speed: 10 },
    party: [{ id: 'p-min-damage', profession: 'Воин', hp: 1000, maxHp: 1000, attack: 1, defense: 0, speed: 20 }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(result.totalDamageToMonster, 1);
});

test('compound physical and magic resistance passive uses the matching damage type', () => {
  const run = (damageType: 'physical' | 'magic') => resolveMonsterBattle({
    monster: { id: 'm-dual-resistance', name: 'Dual ward', hp: 10000, attack: 1, defense: 0, speed: 10, passiveDescription: 'Физический урон −20%; магический урон −15%; ниже 30% HP атака +30%' },
    party: [{ id: `p-${damageType}`, profession: 'Воин', hp: 1000, maxHp: 1000, attack: 100, defense: 0, speed: 20, damageType }],
    maxRounds: 1,
    random: () => 0.5,
  });
  assert.equal(run('physical').totalDamageToMonster, 80);
  assert.equal(run('magic').totalDamageToMonster, 85);
});


test('combat speed equals dexterity plus explicit equipment dexterity bonus', () => {
  assert.equal(calculateCombatSpeed(10, 0), 10);
  assert.equal(calculateCombatSpeed(25, 8), 33);
  assert.equal(calculateCombatSpeed(0, 12), 12);
});

test('combat speed ignores invalid or negative dexterity inputs', () => {
  assert.equal(calculateCombatSpeed(-5, 4), 4);
  assert.equal(calculateCombatSpeed(10, -3), 10);
  assert.equal(calculateCombatSpeed(Number.NaN, Number.POSITIVE_INFINITY), 0);
});


test('player combatant adapter maps resolved stats and equipment dexterity into shared combatant', () => {
  const combatant = adaptPlayerCombatant({
    id: 'player-adapter',
    profession: 'Ассасин',
    hp: 720,
    maxHp: 900,
    attack: 245,
    defense: 118,
    dexterity: 34,
    equipmentDexterityBonus: 12,
    damageType: 'physical',
    buff: 'attack',
    buffValue: 0.15,
    buffSecondaryEffect: 'defense',
    buffSecondaryValue: 0.05,
    buffUntil: 123456,
  });

  assert.deepEqual(combatant, {
    id: 'player-adapter',
    profession: 'Ассасин',
    hp: 720,
    maxHp: 900,
    attack: 245,
    defense: 118,
    speed: 46,
    damageType: 'physical',
    buff: 'attack',
    buffValue: 0.15,
    buffSecondaryEffect: 'defense',
    buffSecondaryValue: 0.05,
    buffUntil: 123456,
  });
});

test('player combatant adapter passes an explicit critical buff as a chance modifier', () => {
  const combatant = adaptPlayerCombatant({
    id: 'player-crit-buff',
    profession: 'Ассасин',
    hp: 100,
    maxHp: 100,
    attack: 50,
    defense: 20,
    dexterity: 30,
    buff: 'crit',
    buffValue: 0.12,
    buffUntil: 5000,
  });

  assert.equal(combatant.attack, 50);
  assert.equal(combatant.critChance, undefined);
  assert.equal(combatant.buff, 'crit');
  assert.equal(combatant.buffValue, 0.12);
  assert.equal(combatant.buffUntil, 5000);
});

test('player combatant adapter supports an unequipped character and omits unresolved combat chances', () => {
  const combatant = adaptPlayerCombatant({
    id: 'player-no-gear',
    profession: 'Воин',
    hp: 100,
    maxHp: 100,
    attack: 12,
    defense: 8,
    dexterity: 10,
  });

  assert.equal(combatant.speed, 10);
  assert.equal(combatant.critChance, undefined);
  assert.equal(combatant.critMultiplier, undefined);
  assert.equal(combatant.accuracy, undefined);
  assert.equal(combatant.damageType, undefined);
});

test('player combatant adapter normalizes invalid stats and clamps optional combat values', () => {
  const combatant = adaptPlayerCombatant({
    id: 'player-invalid',
    profession: '',
    hp: Number.POSITIVE_INFINITY,
    maxHp: Number.NaN,
    attack: -10,
    defense: Number.NaN,
    dexterity: Number.NaN,
    equipmentDexterityBonus: -4,
    critChance: 4,
    critMultiplier: 0.5,
    accuracy: -10,
    buffValue: Number.NaN,
    buffUntil: Number.POSITIVE_INFINITY,
  });

  assert.equal(combatant.profession, 'Без профессии');
  assert.equal(combatant.hp, 0);
  assert.equal(combatant.maxHp, 1);
  assert.equal(combatant.attack, 0);
  assert.equal(combatant.defense, 0);
  assert.equal(combatant.speed, 0);
  assert.equal(combatant.critChance, 1);
  assert.equal(combatant.critMultiplier, 1);
  assert.equal(combatant.accuracy, 0);
  assert.equal(combatant.buffValue, undefined);
  assert.equal(combatant.buffUntil, undefined);
});


test('player monster combat stats preserve legacy stat, gear, set, pendant and active buff modifiers', () => {
  const stats = calculatePlayerMonsterCombatStats({
    profession: 'Воин',
    strength: 10,
    dexterity: 10,
    intelligence: 10,
    vitality: 10,
    stamina: 10,
    baseDefense: 10,
    weaponAttack: 20,
    armorAttack: 5,
    armorDefense: 5,
    weaponDexterityBonus: 4,
    weaponProfileBonus: 0.1,
    weaponLootBonus: 0.05,
    pendantEffect: 'bossDamage',
    pendantValue: 0.1,
    isBoss: true,
    setBonuses: [{ effect: 'attack', itemCount: 2, mastery: 0 }],
    buffs: { attack: 0.2, crit: 0.1, defense: 0.1, loot: 0.2, lifesteal: 0.03 },
    now: 100,
    buffUntil: 200,
  });

  assert.ok(Math.abs(stats.attack - 66.868956) < 0.000001);
  assert.ok(Math.abs(stats.defense - 25.047) < 0.000001);
  assert.equal(stats.speed, 14);
  assert.equal(stats.lootBonus, 0.25);
  assert.equal(stats.lifestealBonus, 0.03);
  assert.equal(stats.profession, 'Воин');
});

test('player monster combat stats preserve dungeon and non-boss pendant boundaries', () => {
  const common = {
    profession: 'Воин',
    strength: 10,
    dexterity: 10,
    intelligence: 10,
    vitality: 10,
    stamina: 10,
    baseDefense: 10,
    pendantEffect: 'bossDamage',
    pendantValue: 0.5,
    buffs: { attack: 0.5, defense: 0.5 },
    now: 100,
    buffUntil: 50,
  };
  const nonBoss = calculatePlayerMonsterCombatStats({ ...common, isBoss: false });
  const dungeonBoss = calculatePlayerMonsterCombatStats({ ...common, isBoss: true });

  assert.equal(nonBoss.attack, 18);
  assert.equal(dungeonBoss.attack, 27);
  assert.equal(nonBoss.defense, 17.27);
  assert.equal(dungeonBoss.defense, 17.27);
});

test('player monster combat stats can preserve the dungeon five-piece set rule', () => {
  const common = {
    profession: 'Воин',
    strength: 10,
    dexterity: 10,
    intelligence: 10,
    vitality: 10,
    stamina: 10,
    baseDefense: 10,
    setBonuses: [{ effect: 'defense', itemCount: 5, mastery: 0 }],
  };
  const expedition = calculatePlayerMonsterCombatStats(common);
  const dungeon = calculatePlayerMonsterCombatStats({ ...common, applyFivePieceSetBonus: false });

  assert.ok(Math.abs(expedition.defense - 19.040175) < 0.000001);
  assert.ok(Math.abs(dungeon.defense - 18.1335) < 0.000001);
});


test('player monster combat stats apply each equipment enhancement to that item exactly once', () => {
  const stats = calculatePlayerMonsterCombatStats({
    profession: 'Воин',
    strength: 10,
    dexterity: 10,
    intelligence: 10,
    vitality: 10,
    stamina: 10,
    baseDefense: 10,
    weaponAttack: 100,
    weaponEnhancementLevel: 2,
    weaponDexterityBonus: 2,
    armorItems: [
      { attack: 10, defense: 20, enhancementLevel: 1 },
      { attack: 30, defense: 40, enhancementLevel: 3 },
    ],
  });

  assert.equal(stats.attack, 170);
  assert.ok(Math.abs(stats.defense - 89.43) < 0.000001);
  assert.equal(stats.speed, 12);
});


test('shared player combat stats preserve active lifesteal buffs and ignore expired ones', () => {
  const common = {
    profession: 'Воин',
    strength: 10,
    dexterity: 10,
    intelligence: 10,
    vitality: 10,
    stamina: 10,
    baseDefense: 10,
    buffs: { attack: 0, crit: 0, defense: 0, loot: 0, lifesteal: 0.08 },
    now: 1000,
  };
  const active = calculatePlayerMonsterCombatStats({ ...common, buffUntil: 2000 });
  const expired = calculatePlayerMonsterCombatStats({ ...common, buffUntil: 999 });

  assert.equal(active.lifestealBonus, 0.08);
  assert.equal(expired.lifestealBonus, 0);
});

test('shared player combat stats do not apply attack, defense or crit buffs after expiration', () => {
  const common = {
    profession: 'Воин',
    strength: 10,
    dexterity: 10,
    intelligence: 10,
    vitality: 10,
    stamina: 10,
    baseDefense: 10,
    buffs: { attack: 0.5, crit: 0.2, defense: 0.5, loot: 0.1, lifesteal: 0.1 },
    now: 1000,
  };
  const expired = calculatePlayerMonsterCombatStats({ ...common, buffUntil: 1000 });
  const baseline = calculatePlayerMonsterCombatStats({ ...common, buffs: {}, buffUntil: 2000 });

  assert.deepEqual(expired, baseline);
});


test('shared player combat stats cover every current combat profession baseline', () => {
  const professions = [
    { profession: 'Боевой маг', attack: 17.05, defense: 15.7 },
    { profession: 'Ассасин', attack: 22.68, defense: 15.7 },
    { profession: 'Воин', attack: 18, defense: 17.27 },
    { profession: 'Баффер', attack: 18, defense: 15.7 },
    { profession: 'Лучник', attack: 22.26, defense: 15.7 },
    { profession: 'Вампир', attack: 21, defense: 15.7 },
    { profession: 'Добытчик', attack: 18, defense: 15.7 },
  ];

  for (const expected of professions) {
    const actual = calculatePlayerMonsterCombatStats({
      profession: expected.profession,
      strength: 10,
      dexterity: 10,
      intelligence: 10,
      vitality: 10,
      stamina: 10,
      baseDefense: 10,
    });
    assert.ok(Math.abs(actual.attack - expected.attack) < 0.000001, expected.profession + ' attack');
    assert.ok(Math.abs(actual.defense - expected.defense) < 0.000001, expected.profession + ' defense');
    assert.equal(actual.speed, 10, expected.profession + ' speed');
  }
});

test('shared player combat stats route profile bonuses to the profession-specific output', () => {
  const buffer = calculatePlayerMonsterCombatStats({
    profession: 'Баффер',
    strength: 10, dexterity: 10, intelligence: 10, vitality: 10, stamina: 10,
    baseDefense: 10, weaponProfileBonus: 0.2,
  });
  const warrior = calculatePlayerMonsterCombatStats({
    profession: 'Воин',
    strength: 10, dexterity: 10, intelligence: 10, vitality: 10, stamina: 10,
    baseDefense: 10, weaponProfileBonus: 0.2,
  });
  const gatherer = calculatePlayerMonsterCombatStats({
    profession: 'Добытчик',
    strength: 10, dexterity: 10, intelligence: 10, vitality: 10, stamina: 10,
    baseDefense: 10, weaponLootBonus: 0.25,
  });

  assert.ok(Math.abs(buffer.defense - 18.84) < 0.000001);
  assert.equal(buffer.attack, 18);
  assert.ok(Math.abs(warrior.attack - 21.6) < 0.000001);
  assert.equal(warrior.defense, 15.7);
  assert.equal(gatherer.lootBonus, 0.25);
  assert.equal(gatherer.attack, 18);
});


test('catalog combat effects map to typed modifiers without collapsing into attack', () => {
  assert.deepEqual(parseMonsterCombatEffect('+5% к критическому шансу'), { target: 'critChance', value: 0.05 });
  assert.deepEqual(parseMonsterCombatEffect('+8% к критическому урону'), { target: 'critDamage', value: 0.08 });
  assert.deepEqual(parseMonsterCombatEffect('Восстанавливает 3% максимального здоровья после победы'), { target: 'lifesteal', value: 0.03 });
  assert.deepEqual(parseMonsterCombatEffect('+8% к магическому урону'), { target: 'magicDamage', value: 0.08 });
  assert.deepEqual(parseMonsterCombatEffect('+8% к физическому урону'), { target: 'physicalDamage', value: 0.08 });
  assert.deepEqual(parseMonsterCombatEffect('+8% к урону по боссам'), { target: 'bossDamage', value: 0.08 });
  assert.deepEqual(parseMonsterCombatEffect('+5% к количеству обычных ресурсов'), { target: 'loot', value: 0.05 });
  assert.deepEqual(parseMonsterCombatEffect('+8% к физической защите'), { target: 'defense', value: 0.08 });
  assert.equal(parseMonsterCombatEffect('+6% профильного параметра'), undefined);
  assert.equal(parseMonsterCombatEffect('+5% к HP; +8% к защите'), undefined);
  assert.equal(parseMonsterCombatEffect('+5% к HP и +8% к защите'), undefined);
  assert.equal(parseMonsterCombatEffect('Усиление роли'), undefined);
  assert.equal(parseMonsterCombatEffect('Нет'), undefined);
});
