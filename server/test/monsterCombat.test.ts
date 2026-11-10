import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { getMonsterPassiveDescriptions, parseMonsterWeakness, resolveMonsterPassive } from '../src/monsterCombat.js';

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

test('monster weakness parser converts profession bonus into a multiplier value', () => {
  assert.deepEqual(parseMonsterWeakness('Маг +25%'), { profession: 'Маг', bonus: 0.25 });
  assert.deepEqual(parseMonsterWeakness('Лучник +10%'), { profession: 'Лучник', bonus: 0.10 });
  assert.equal(parseMonsterWeakness('нет'), undefined);
  assert.equal(parseMonsterWeakness('Маг +x%'), undefined);
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
