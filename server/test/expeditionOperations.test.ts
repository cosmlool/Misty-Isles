import assert from 'node:assert/strict';
import test from 'node:test';
import { checkExpeditionTravelReadiness } from '../src/expeditionOperations.js';

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
