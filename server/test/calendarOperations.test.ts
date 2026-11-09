import assert from 'node:assert/strict';
import test from 'node:test';
import { utcIsoWeekKey } from '../src/calendarOperations.js';

test('UTC ISO week keys follow Monday-based week boundaries and ISO week-years', () => {
  assert.equal(utcIsoWeekKey(new Date('2026-01-04T12:00:00.000Z')), '2026-W01');
  assert.equal(utcIsoWeekKey(new Date('2026-01-05T00:00:00.000Z')), '2026-W02');
  assert.equal(utcIsoWeekKey(new Date('2020-12-31T00:00:00.000Z')), '2020-W53');
  assert.equal(utcIsoWeekKey(new Date('2021-01-01T00:00:00.000Z')), '2020-W53');
  assert.equal(utcIsoWeekKey(new Date('2021-01-04T00:00:00.000Z')), '2021-W01');
});

test('UTC ISO week key rejects invalid dates', () => {
  assert.throws(() => utcIsoWeekKey(new Date(Number.NaN)), /valid date/i);
});
