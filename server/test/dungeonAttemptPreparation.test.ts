import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeDungeonAttemptForDay, getDungeonRunsForDay } from '../src/dungeonAttemptPreparation.js';

test('reads attempts only for the matching UTC day key', () => {
  assert.equal(getDungeonRunsForDay({ dungeonDay: '2026-11-13', dungeonRuns: 2 }, '2026-11-13'), 2);
  assert.equal(getDungeonRunsForDay({ dungeonDay: '2026-11-12', dungeonRuns: 3 }, '2026-11-13'), 0);
  assert.equal(getDungeonRunsForDay({}, '2026-11-13'), 0);
});

test('consumes the first attempt after a day rollover and preserves unrelated quest state', () => {
  const original = { dungeonDay: '2026-11-12', dungeonRuns: 3, dungeonLastRequest: { id: 'keep' } };
  const next = consumeDungeonAttemptForDay(original, '2026-11-13');
  assert.deepEqual(next, { dungeonDay: '2026-11-13', dungeonRuns: 1, dungeonLastRequest: { id: 'keep' } });
  assert.deepEqual(original, { dungeonDay: '2026-11-12', dungeonRuns: 3, dungeonLastRequest: { id: 'keep' } });
});

test('increments attempts on the same day without mutating the input', () => {
  const original = { dungeonDay: '2026-11-13', dungeonRuns: 2, other: true };
  assert.deepEqual(consumeDungeonAttemptForDay(original, '2026-11-13'), {
    dungeonDay: '2026-11-13', dungeonRuns: 3, other: true,
  });
  assert.equal(original.dungeonRuns, 2);
});

test('preserves legacy numeric coercion for stored attempt values', () => {
  assert.equal(getDungeonRunsForDay({ dungeonDay: '2026-11-13', dungeonRuns: '2' }, '2026-11-13'), 2);
  assert.equal(consumeDungeonAttemptForDay({ dungeonDay: '2026-11-13', dungeonRuns: '2' }, '2026-11-13').dungeonRuns, 3);
});
