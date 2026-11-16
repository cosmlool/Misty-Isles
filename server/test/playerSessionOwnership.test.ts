import assert from 'node:assert/strict';
import test from 'node:test';
import { canSaveRoomPlayerSnapshot, isCurrentRoomSession } from '../src/playerSessionOwnership.js';

test('only the currently registered client and player instance own a live session', () => {
  const oldPlayer = {};
  const newPlayer = {};
  const oldClient = {};
  const newClient = {};

  assert.equal(isCurrentRoomSession(
    { player: oldPlayer, client: oldClient, sessionHash: 'old-token' },
    { player: oldPlayer, client: oldClient, sessionHash: 'old-token' },
  ), true);

  assert.equal(isCurrentRoomSession(
    { player: newPlayer, client: newClient, sessionHash: 'new-token' },
    { player: oldPlayer, client: oldClient, sessionHash: 'old-token' },
  ), false);
});

test('an old room cannot overwrite a newer online player snapshot', () => {
  const oldRoomPlayer = { gold: 100 };
  const newRoomPlayer = { gold: 250 };

  assert.equal(canSaveRoomPlayerSnapshot(newRoomPlayer, oldRoomPlayer), false);
  assert.equal(canSaveRoomPlayerSnapshot(newRoomPlayer, newRoomPlayer), true);
  assert.equal(canSaveRoomPlayerSnapshot(undefined, oldRoomPlayer), true);
});
