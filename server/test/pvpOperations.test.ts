import assert from 'node:assert/strict';
import test from 'node:test';
import { isKnownPvpBotId } from '../src/pvpOperations.js';

test('only the four catalogued arena bots are valid bot targets', () => {
  for (const id of ['bot_ember', 'bot_bastion', 'bot_gale', 'bot_relic']) {
    assert.equal(isKnownPvpBotId(id), true);
  }
  assert.equal(isKnownPvpBotId('bot_admin'), false);
  assert.equal(isKnownPvpBotId('bot_anything'), false);
  assert.equal(isKnownPvpBotId(''), false);
});
