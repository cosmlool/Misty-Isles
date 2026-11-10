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
