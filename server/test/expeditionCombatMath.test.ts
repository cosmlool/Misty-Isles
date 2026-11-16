import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateExpeditionCombatPlan } from '../src/expeditionCombatMath.js';
const member = (overrides: Partial<Parameters<typeof calculateExpeditionCombatPlan>[0]['participants'][number]> = {}) => ({
  attack:20,defense:10,health:100,resistanceMultiplier:1,weaknessMultiplier:1,hitMultiplier:1,
  incomingProfessionMultiplier:1,incomingHitMultiplier:1,...overrides,
});
test('solo: preserves legacy defense, DPS, rounds and incoming damage order',()=>{
 const r=calculateExpeditionCombatPlan({monsterHp:100,partySize:1,monsterDefense:20,monsterDefenseMultiplier:1.1,monsterAttack:80,monsterAttackMultiplier:1.2,groupGuard:0,participants:[member({attack:30,defense:20,health:200,resistanceMultiplier:.9,weaknessMultiplier:1.25,hitMultiplier:.85,incomingHitMultiplier:.8})]});
 const dps=30*7*(100/122)*.9*1.25*.85, rounds=Math.max(1,Math.ceil(100/Math.max(1,dps))), incoming=Math.max(1,Math.floor((96*.20-20*.12)*rounds*.8));
 assert.equal(r.groupHp,100);assert.equal(r.effectiveMonsterDefense,22);assert.equal(r.monsterAttack,96);assert.equal(r.totalDps,dps);assert.equal(r.rounds,rounds);assert.deepEqual(r.incoming,[incoming]);assert.equal(r.win,rounds<=8&&200>incoming);
});
test('duo and trio: party HP scaling and participant-specific effects',()=>{
 const base={monsterHp:500,partySize:2,monsterDefense:10,monsterDefenseMultiplier:1.15,monsterAttack:100,monsterAttackMultiplier:1.1,groupGuard:.08,participants:[member({attack:30,defense:20,health:120,resistanceMultiplier:.9,weaknessMultiplier:1.1,hitMultiplier:.95,incomingProfessionMultiplier:.9}),member({attack:25,defense:30,health:100,weaknessMultiplier:.8,incomingHitMultiplier:.75})]};
 const duo=calculateExpeditionCombatPlan(base);assert.equal(duo.groupHp,775);assert.equal(duo.incoming.length,2);
 const trio=calculateExpeditionCombatPlan({...base,partySize:3,participants:[...base.participants,member({attack:15,defense:5,health:80,incomingProfessionMultiplier:1.2,incomingHitMultiplier:.9})]});
 assert.equal(trio.groupHp,1050);assert.equal(trio.incoming.length,3);
});
test('zero DPS uses the legacy minimum denominator and victory is capped at eight rounds',()=>{
 const r=calculateExpeditionCombatPlan({monsterHp:9,partySize:1,monsterDefense:0,monsterDefenseMultiplier:1,monsterAttack:1,monsterAttackMultiplier:1,groupGuard:0,participants:[member({attack:0,health:1000})]});
 assert.equal(r.totalDps,0);assert.equal(r.rounds,9);assert.equal(r.win,false);
});
test('exactly lethal incoming damage loses; one additional HP survives',()=>{
 const input={monsterHp:1,partySize:1,monsterDefense:0,monsterDefenseMultiplier:1,monsterAttack:100,monsterAttackMultiplier:1,groupGuard:0,participants:[member({attack:100,defense:0,health:20})]};
 const lethal=calculateExpeditionCombatPlan(input);assert.equal(lethal.incoming[0],20);assert.equal(lethal.win,false);
 const survivor=calculateExpeditionCombatPlan({...input,participants:[{...input.participants[0],health:21}]});assert.equal(survivor.incoming[0],20);assert.equal(survivor.win,true);
});
test('every participant must survive and rounds greater than eight lose',()=>{
 const input={monsterHp:1,partySize:2,monsterDefense:0,monsterDefenseMultiplier:1,monsterAttack:100,monsterAttackMultiplier:1,groupGuard:.08,participants:[member({attack:100,health:100}),member({attack:100,health:1})]};
 assert.equal(calculateExpeditionCombatPlan(input).win,false);
 const slow=calculateExpeditionCombatPlan({...input,monsterHp:9000,participants:input.participants.map(p=>({...p,health:1000}))});assert.ok(slow.rounds>8);assert.equal(slow.win,false);
});


test('matches the legacy inline formula across a deterministic modifier matrix', () => {
  const legacy = (input: Parameters<typeof calculateExpeditionCombatPlan>[0]) => {
    const groupHp = input.monsterHp * (1 + .55 * (input.partySize - 1));
    const effectiveMonsterDefense = Math.max(0, Number(input.monsterDefense || 0)) * input.monsterDefenseMultiplier;
    const totalDps = input.participants.reduce((sum, x) =>
      sum + x.attack * 7 * (100 / (100 + effectiveMonsterDefense)) *
        x.resistanceMultiplier * x.weaknessMultiplier * x.hitMultiplier, 0);
    const rounds = Math.max(1, Math.ceil(groupHp / Math.max(1, totalDps)));
    const monsterAttack = input.monsterAttack * input.monsterAttackMultiplier;
    const incoming = input.participants.map(x => Math.max(1, Math.floor(
      (monsterAttack * .20 - x.defense * .12) * rounds *
      x.incomingProfessionMultiplier * (1 - input.groupGuard) * x.incomingHitMultiplier
    )));
    const win = rounds <= 8 && input.participants.every((x, i) => x.health > incoming[i]);
    return { groupHp, effectiveMonsterDefense, monsterAttack, totalDps, rounds, incoming, win };
  };
  for (let scenario = 0; scenario < 36; scenario++) {
    const partySize = 1 + (scenario % 3);
    const participants = Array.from({ length: partySize }, (_, index) => member({
      attack: (scenario * 13 + index * 17) % 91,
      defense: (scenario * 7 + index * 11) % 46,
      health: (scenario * 19 + index * 23) % 240,
      resistanceMultiplier: [.65, .8, 1, 1.15][(scenario + index) % 4],
      weaknessMultiplier: [.75, 1, 1.2][(scenario * 2 + index) % 3],
      hitMultiplier: [.7, .9, 1][(scenario + index * 2) % 3],
      incomingProfessionMultiplier: [.8, 1, 1.25][(scenario + index) % 3],
      incomingHitMultiplier: [.75, .95, 1][(scenario * 3 + index) % 3],
    }));
    const input = {
      monsterHp: 1 + ((scenario * 127) % 1800),
      partySize,
      monsterDefense: (scenario * 5) % 70,
      monsterDefenseMultiplier: [.8, 1, 1.1, 1.3][scenario % 4],
      monsterAttack: (scenario * 29) % 170,
      monsterAttackMultiplier: [.75, 1, 1.2][scenario % 3],
      groupGuard: scenario % 2 ? .08 : 0,
      participants,
    };
    assert.deepEqual(calculateExpeditionCombatPlan(input), legacy(input), `scenario ${scenario}`);
  }
});
