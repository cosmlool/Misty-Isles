import assert from 'node:assert/strict';
import test from 'node:test';
import { checkExpeditionTravelConsistency, checkExpeditionTravelReadiness } from '../src/expeditionOperations.js';

test('group travel waits for the latest participant before any transition is applied', () => {
  const states = [
    { state: 'moving', endsAt: 10_000 },
    { state: 'moving', endsAt: 10_025 },
  ];
  assert.deepEqual(checkExpeditionTravelReadiness(states, 10_000), {
    ready: false, reason: 'waiting', remainingMs: 25,
  });
  assert.deepEqual(checkExpeditionTravelReadiness(states, 10_025), {
    ready: true, remainingMs: 0,
  });
});

test('group travel rejects empty or inconsistent participant state', () => {
  assert.deepEqual(checkExpeditionTravelReadiness([], 10_000), {
    ready: false, reason: 'not-moving', remainingMs: 0,
  });
  assert.deepEqual(checkExpeditionTravelReadiness([
    { state: 'moving', endsAt: 10_000 },
    { state: 'idle', endsAt: 10_000 },
  ], 10_000), {
    ready: false, reason: 'not-moving', remainingMs: 0,
  });
});

test('group travel requires every participant to share the same group and route', () => {
  const shared = [
    { state: 'moving', endsAt: 10_000, groupId: 'group-a', currentZoneId: 'el1', targetZoneId: 'el2' },
    { state: 'moving', endsAt: 10_025, groupId: 'group-a', currentZoneId: 'el1', targetZoneId: 'el2' },
  ];
  assert.deepEqual(checkExpeditionTravelConsistency(shared, 'group-a'), { consistent: true });
  assert.deepEqual(checkExpeditionTravelConsistency([
    { ...shared[0]!, targetZoneId: 'el2' },
    { ...shared[1]!, targetZoneId: 'el3' },
  ], 'group-a'), { consistent: false, reason: 'mismatch' });
  assert.deepEqual(checkExpeditionTravelConsistency([
    shared[0]!,
    { ...shared[1]!, currentZoneId: 'el4' },
  ], 'group-a'), { consistent: false, reason: 'mismatch' });
  assert.deepEqual(checkExpeditionTravelConsistency([
    shared[0]!,
    { ...shared[1]!, groupId: 'group-b' },
  ], 'group-a'), { consistent: false, reason: 'mismatch' });
  assert.deepEqual(checkExpeditionTravelConsistency([
    { state: 'moving', groupId: '', currentZoneId: 'el1', targetZoneId: 'el2' },
  ], ''), { consistent: true });
  assert.deepEqual(checkExpeditionTravelConsistency([
    { state: 'moving', groupId: 'group-a', currentZoneId: 'el1' },
  ], 'group-a'), { consistent: false, reason: 'mismatch' });
});

test('group travel rejects missing, non-finite and invalid completion timestamps', () => {
  for (const endsAt of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.deepEqual(checkExpeditionTravelReadiness([
      { state: 'moving', endsAt },
    ], 10_000), { ready: false, reason: 'not-moving', remainingMs: 0 });
  }
});
