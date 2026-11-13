import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareDungeonMemberQuestSettlement } from '../src/dungeonMemberQuestSettlement.js';

const report = { result: 'win', rewards: { xp: 100 } };
const activity = {
  type: 'dungeon',
  outcome: 'win',
  title: 'Подземелье Забытых земель пройдено',
  place: 'Каменный склеп',
  enemy: 'Страж',
  gold: 50,
  xp: 100,
  detail: 'Победа над Стражем',
};

test('prepares activity, combat history, request replay and outbox event in one detached quest snapshot', () => {
  const quests = {
    activityDay: '2026-11-12',
    activityToday: { hunts: 3, wins: 2, losses: 1, gold: 20, xp: 30, dungeons: 4, crafts: 5 },
    activityLog: [{ type: 'hunt' }],
    combatHistory: [{ result: 'prior' }],
    dungeonRequestHistory: [{ id: 'prior' }],
    retained: true,
  };
  const result = prepareDungeonMemberQuestSettlement({
    quests,
    now: Date.parse('2026-11-13T12:00:00.000Z'),
    activity,
    report,
    requestId: 'request_123',
    playerId: 'player-1',
    text: 'done',
  });

  assert.equal(result.quests.activityDay, '2026-11-13');
  assert.deepEqual(result.quests.activityToday, {
    hunts: 0, wins: 0, losses: 0, gold: 50, xp: 100, dungeons: 1, crafts: 0,
  });
  assert.deepEqual(result.quests.activityLog, [{ at: Date.parse('2026-11-13T12:00:00.000Z'), ...activity }, { type: 'hunt' }]);
  assert.deepEqual(result.history, [report, { result: 'prior' }]);
  assert.deepEqual(result.quests.dungeonRequestHistory, [
    { id: 'prior' }, { id: 'request_123', report, text: 'done' },
  ]);
  assert.equal(result.quests.retained, true);
  assert.equal(result.event.playerId, 'player-1');
  assert.equal(result.quests === quests, false);
  assert.equal(quests.activityDay, '2026-11-12');
  assert.equal(quests.activityToday.dungeons, 4);
  assert.equal(quests.activityLog.length, 1);
  assert.equal(quests.combatHistory.length, 1);
});

test('preserves same-day counters and trims activity and combat histories to legacy limits', () => {
  const quests = {
    activityDay: '2026-11-13',
    activityToday: { hunts: 2, wins: 1, losses: 1, gold: 7, xp: 9, dungeons: 3, crafts: 4 },
    activityLog: Array.from({ length: 30 }, (_, i) => ({ id: i })),
    combatHistory: Array.from({ length: 20 }, (_, i) => ({ id: i })),
  };
  const result = prepareDungeonMemberQuestSettlement({
    quests,
    now: Date.parse('2026-11-13T13:00:00.000Z'),
    activity,
    report,
    requestId: 'request_456',
    playerId: 'player-2',
    text: 'done',
  });
  assert.deepEqual(result.quests.activityToday, {
    hunts: 2, wins: 1, losses: 1, gold: 57, xp: 109, dungeons: 4, crafts: 4,
  });
  assert.equal(result.quests.activityLog.length, 30);
  assert.equal(result.quests.activityLog[0].id, undefined);
  assert.equal(result.quests.combatHistory.length, 20);
  assert.equal(result.quests.combatHistory[0], report);
});

test('uses empty logs when persisted history values are not arrays', () => {
  const result = prepareDungeonMemberQuestSettlement({
    quests: { activityLog: 'invalid', combatHistory: null },
    now: Date.parse('2026-11-13T13:00:00.000Z'),
    activity,
    report,
    requestId: 'request_789',
    playerId: 'player-3',
    text: 'done',
  });
  assert.deepEqual(result.quests.activityLog, [{ at: Date.parse('2026-11-13T13:00:00.000Z'), ...activity }]);
  assert.deepEqual(result.history, [report]);
});
