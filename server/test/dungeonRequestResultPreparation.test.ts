import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDungeonRequestResult } from '../src/dungeonRequestResultPreparation.js';

test('replaces matching request, preserves other entries and caps history at five', () => {
  const quests = {
    keep: true,
    dungeonRequestHistory: [
      { id: 'old-1' }, { id: 'retry' }, { id: 'old-2' }, { id: 'old-3' }, { id: 'old-4' },
    ],
  };
  const report = { result: 'win' };
  const result = prepareDungeonRequestResult(quests, 'retry', 'player-1', report, 'done');
  assert.deepEqual(result.quests.dungeonRequestHistory, [
    { id: 'old-1' }, { id: 'old-2' }, { id: 'old-3' }, { id: 'old-4' },
    { id: 'retry', report, text: 'done' },
  ]);
  assert.deepEqual(result.quests.dungeonLastRequest, { id: 'retry', report, text: 'done' });
  assert.equal(result.quests.keep, true);
  assert.deepEqual(quests.dungeonRequestHistory[1], { id: 'retry' });
});

test('builds the legacy stable event identity and payload', () => {
  const report = { result: 'loss' };
  const result = prepareDungeonRequestResult({}, 'request_123', 'player-2', report, 'failed');
  assert.deepEqual(result.event, {
    eventId: 'dungeon:legacy_request_123:player-2:combatResult',
    runId: 'legacy_request_123',
    playerId: 'player-2',
    messageType: 'combatResult',
    payload: {
      eventId: 'dungeon:legacy_request_123:player-2:combatResult',
      report,
      text: 'failed',
      requestId: 'request_123',
    },
  });
});

test('uses an empty history when the stored value is not an array', () => {
  const result = prepareDungeonRequestResult({ dungeonRequestHistory: 'invalid' }, 'request_456', 'p', {}, 'ok');
  assert.deepEqual(result.quests.dungeonRequestHistory, [
    { id: 'request_456', report: {}, text: 'ok' },
  ]);
});

test('does not mutate the source quest object or its history array', () => {
  const history = [{ id: 'prior' }];
  const quests = { dungeonRequestHistory: history, other: 7 };
  const result = prepareDungeonRequestResult(quests, 'request_789', 'p', {}, 'ok');
  assert.equal(quests.dungeonRequestHistory, history);
  assert.equal(history.length, 1);
  assert.equal(result.quests === quests, false);
});
