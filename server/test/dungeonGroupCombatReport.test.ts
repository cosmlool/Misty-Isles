import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDungeonGroupCombatReport } from '../src/dungeonGroupCombatReport.js';

const shared = {
  at: 123456,
  dungeonName: 'Пещеры забвения',
  bossName: 'Страж глубин',
  bossRank: 'boss',
  passiveName: 'Каменная кожа',
  passiveDescription: 'снижает входящий урон',
  weakness: 'огонь',
  partySize: 3,
  rounds: 6,
  xp: 3100,
  gold: 616,
  loot: 'Клык стража, Кристалл',
};

test('builds the legacy victory report with exact fields, rewards and line order', () => {
  const report = buildDungeonGroupCombatReport({ ...shared, result: 'win' });
  assert.deepEqual(report, {
    at: 123456,
    mode: 'Подземелье',
    zone: 'Пещеры забвения',
    enemy: 'Страж глубин',
    rank: 'boss',
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
    rewards: { xp: 3100, gold: 616, loot: 'Клык стража, Кристалл' },
    lines: [
      'Подземелье: Пещеры забвения. Финальный страж: Страж глубин.',
      'Пассивный навык стража: Каменная кожа — снижает входящий урон. Слабость: огонь.',
      'Группа: 3/3. Раундов: 6.',
      'Опыт начислен каждому участнику; золото разделено; предметы распределены между участниками.',
    ],
  });
});

test('builds the legacy loss report with zero rewards and exact line order', () => {
  const report = buildDungeonGroupCombatReport({ ...shared, result: 'loss' });
  assert.deepEqual(report, {
    at: 123456,
    mode: 'Подземелье',
    zone: 'Пещеры забвения',
    enemy: 'Страж глубин',
    rank: 'boss',
    result: 'loss',
    profession: '',
    level: 0,
    attack: 0,
    defense: 0,
    damage: 0,
    received: 0,
    hpBefore: 0,
    hpAfter: 0,
    maxHealth: 0,
    rewards: { xp: 0, gold: 0, loot: '' },
    lines: [
      'Группа не прошла подземелье «Пещеры забвения».',
      'Страж: Страж глубин. Пассивный навык: Каменная кожа.',
      'Попытка израсходована; награды не получены.',
    ],
  });
});

test('uses the supplied timestamp unchanged and does not mutate the input', () => {
  const input = { ...shared, result: 'win' as const };
  const original = structuredClone(input);
  const report = buildDungeonGroupCombatReport(input);
  assert.equal(report.at, input.at);
  assert.deepEqual(input, original);
  assert.notEqual(report.rewards, input);
});
