import assert from 'node:assert/strict';
import test from 'node:test';

import { Player } from '../src/PlayerSchema.js';

test('Player schema remains within Colyseus 64-field limit', () => {
  const player = new Player();
  assert.equal(player.lastDailyAt, 0);
  assert.equal(player.lastMineAt, 0);
  assert.equal(player.lastWorkAt, 0);
});
