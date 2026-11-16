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
