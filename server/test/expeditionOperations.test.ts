import assert from 'node:assert/strict';
import test from 'node:test';
import { canInviteToHuntGroup, expireHuntGroupInvites, checkExpeditionTravelConsistency, checkExpeditionTravelReadiness, checkExpeditionTravelStartReadiness, countHuntGroupInvites, invalidateHuntGroupInvites, isHuntGroupLevelRangeValid } from '../src/expeditionOperations.js';

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

test('group travel cannot overwrite another participant search or travel action', () => {
  assert.deepEqual(checkExpeditionTravelStartReadiness([]), { ready: false, reason: 'empty' });
  assert.deepEqual(checkExpeditionTravelStartReadiness([
    { state: 'idle' },
    { state: 'searching' },
  ]), { ready: false, reason: 'busy' });
  assert.deepEqual(checkExpeditionTravelStartReadiness([
    { state: 'idle' },
    { state: 'moving' },
  ]), { ready: false, reason: 'busy' });
  assert.deepEqual(checkExpeditionTravelStartReadiness([
    { state: 'idle' },
    { state: 'idle' },
  ]), { ready: true });
});


test('hunt group levels stay within five levels of the leader, inclusively', () => {
  assert.equal(isHuntGroupLevelRangeValid(35, [30, 35, 40]), true);
  assert.equal(isHuntGroupLevelRangeValid(35, [29, 35]), false);
  assert.equal(isHuntGroupLevelRangeValid(35, [35, 41]), false);
  assert.equal(isHuntGroupLevelRangeValid(100, [95, 100]), true);
  assert.equal(isHuntGroupLevelRangeValid(35, [35, Number.NaN]), false);
  assert.equal(isHuntGroupLevelRangeValid(Number.NaN, [35]), false);
  assert.equal(isHuntGroupLevelRangeValid(35, []), false);
});


test('leadership change invalidates every pending invitation for the old group', () => {
  const invites = new Map([['player-a', 'group-a'], ['player-b', 'group-b'], ['player-c', 'group-a']]);
  assert.equal(invalidateHuntGroupInvites(invites, 'group-a'), 2);
  assert.deepEqual(Array.from(invites.entries()), [['player-b', 'group-b']]);
  assert.equal(invalidateHuntGroupInvites(invites, 'group-a'), 0);
  assert.equal(invalidateHuntGroupInvites(invites, ''), 0);
});


test('pending group invitations reserve the remaining member slots', () => {
  const invites = new Map([['player-a', 'group-a'], ['player-b', 'group-a'], ['player-c', 'group-b']]);
  assert.equal(countHuntGroupInvites(invites, 'group-a'), 2);
  assert.equal(countHuntGroupInvites(invites, 'group-b'), 1);
  assert.equal(countHuntGroupInvites(invites, 'missing'), 0);
  assert.equal(canInviteToHuntGroup(1, 0), true);
  assert.equal(canInviteToHuntGroup(1, 1), true);
  assert.equal(canInviteToHuntGroup(1, 2), false);
  assert.equal(canInviteToHuntGroup(2, 1), false);
  assert.equal(canInviteToHuntGroup(3, 0), false);
  assert.equal(canInviteToHuntGroup(0, 0), false);
  assert.equal(canInviteToHuntGroup(1, -1), false);
});


test('hunt group invitations expire after their deadline and release reserved slots', () => {
  const invites = new Map([['player-a', 'group-a'], ['player-b', 'group-a'], ['player-c', 'group-b']]);
  const expiries = new Map([['player-a', 5_000], ['player-b', 5_001], ['player-c', 9_000]]);
  assert.equal(expireHuntGroupInvites(invites, expiries, 5_000), 1);
  assert.deepEqual(Array.from(invites.entries()), [['player-b', 'group-a'], ['player-c', 'group-b']]);
  assert.deepEqual(Array.from(expiries.entries()), [['player-b', 5_001], ['player-c', 9_000]]);
  assert.equal(countHuntGroupInvites(invites, 'group-a'), 1);
  assert.equal(expireHuntGroupInvites(invites, expiries, 5_001), 1);
  assert.deepEqual(Array.from(invites.entries()), [['player-c', 'group-b']]);
  assert.equal(expireHuntGroupInvites(invites, expiries, 10_000), 0);
});

test('expired invitations are removed even when their expiry record is invalid', () => {
  const invites = new Map([['player-a', 'group-a']]);
  const expiries = new Map([['player-a', Number.NaN]]);
  assert.equal(expireHuntGroupInvites(invites, expiries, 1_000), 1);
  assert.equal(invites.has('player-a'), false);
});
