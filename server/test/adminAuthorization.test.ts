import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAdminPlayerIds } from '../src/adminAuthorization.js';

test('admin commands are disabled when no player IDs are configured', () => {
  assert.equal(parseAdminPlayerIds(undefined).size, 0);
  assert.equal(parseAdminPlayerIds('').size, 0);
  assert.equal(parseAdminPlayerIds(' , , ').size, 0);
});

test('admin allowlist parses comma-separated exact player IDs and trims whitespace', () => {
  const allowed = parseAdminPlayerIds(' player_one,player_two , player_three ');
  assert.deepEqual([...allowed], ['player_one', 'player_two', 'player_three']);
  assert.equal(allowed.has('player_two'), true);
  assert.equal(allowed.has('PLAYER_TWO'), false);
  assert.equal(allowed.has('player_four'), false);
});
