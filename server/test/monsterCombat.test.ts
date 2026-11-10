import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { getMonsterPassiveDescriptions, parseMonsterWeakness, resolveMonsterPassive } from '../src/monsterCombat.js';
import { resolveMonsterBattle } from '../src/monsterBattle.js';

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
