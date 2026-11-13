import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDungeonMemberCombatReport } from '../src/dungeonMemberCombatReport.js';

const baseReport = {
  at: 123,
  mode: 'Подземелье',
  result: 'win',
  profession: '',
  level: 0,
  attack: 0,
  defense: 0,
  damage: 0,
  received: 0,
  hpBefore: 0,
  hpAfter: 0,
  maxHealth: 0,
  rewards: { xp: 420, gold: 220, loot: 'общая добыча' },
  lines: ['Результат группы'],
};

test('builds an individual victory report with floored combat stats and personal rewards', () => {
  const report = buildDungeonMemberCombatReport({
    baseReport, profession: 'Рыцарь', level: 25, attack: 12.9, defense: 8.8,
    damage: 42.7, received: 11, hpBefore: 100, hpAfter: 95, maxHealth: 120,
    rewards: { xp: 500, gold: 110, loot: 'Перо' },
  });
  assert.deepEqual(report, {
    ...baseReport,
    profession: 'Рыцарь', level: 25, attack: 12, defense: 8, damage: 42,
    received: 11, hpBefore: 100, hpAfter: 95, maxHealth: 120,
    rewards: { xp: 500, gold: 110, loot: 'Перo' },
  });
  assert.notEqual(report.rewards, baseReport.rewards);
});

test('preserves loss rewards from the base report when no personal override is supplied', () => {
  const lossBase = { ...baseReport, result: 'loss', rewards: { xp: 0, gold: 0, loot: '' } };
  const report = buildDungeonMemberCombatReport({
    baseReport: lossBase, profession: 'Лучник', level: 20, attack: 4.9, defense: 3.9,
    damage: 7.9, received: 15, hpBefore: 20, hpAfter: 5, maxHealth: 50,
  });
  assert.equal(report.result, 'loss');
  assert.deepEqual(report.rewards, { xp: 0, gold: 0, loot: '' });
});

test('uses the legacy profession fallback and does not mutate the shared report', () => {
  const original = structuredClone(baseReport);
  const report = buildDungeonMemberCombatReport({
    baseReport, profession: '', level: 1, attack: 1, defense: 2, damage: 3,
    received: 4, hpBefore: 5, hpAfter: 1, maxHealth: 6,
    rewards: { xp: 0, gold: 0, loot: '' },
  });
  assert.equal(report.profession, 'Без профессии');
  assert.deepEqual(baseReport, original);
});
