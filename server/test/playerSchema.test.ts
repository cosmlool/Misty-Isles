import assert from 'node:assert/strict';
import test from 'node:test';

import { Player } from '../src/PlayerSchema.js';

test('Player schema remains within Colyseus 64-field limit', () => {
  const player = new Player();
  assert.equal(player.lastDailyAt, 0);
  assert.equal(player.lastMineAt, 0);
  assert.equal(player.lastWorkAt, 0);
});

test('server-only cooldown fields are not included in synchronized schema JSON', () => {
  const player = new Player();
  player.lastMineAt = 123456;
  player.lastWorkAt = 654321;
  const saved = player.toJSON() as Record<string, unknown>;
  assert.equal(Object.hasOwn(saved, 'lastMineAt'), false);
  assert.equal(Object.hasOwn(saved, 'lastWorkAt'), false);
});
