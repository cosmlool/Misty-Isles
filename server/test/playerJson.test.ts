import assert from 'node:assert/strict';
import test from 'node:test';
import { readPlayerArray, readPlayerObject } from '../src/playerJson.js';

test('valid player arrays and objects are parsed', () => {
  assert.deepEqual(readPlayerArray('["wood_sword"]', 'inventory'), ['wood_sword']);
  assert.deepEqual(readPlayerObject('{"weapon":"wood_sword"}', 'equipment'), { weapon: 'wood_sword' });
});

test('malformed player inventory JSON is rejected instead of becoming an empty inventory', () => {
  assert.throws(() => readPlayerArray('["wood_sword"', 'inventory'), /invalid JSON/);
});

test('malformed player object JSON is rejected instead of becoming an empty object', () => {
  assert.throws(() => readPlayerObject('{"gold":', 'collections'), /invalid JSON/);
});

test('wrong JSON root types are rejected', () => {
  assert.throws(() => readPlayerArray('{"item":"wood_sword"}', 'inventory'), /expected an array/);
  assert.throws(() => readPlayerObject('["weapon"]', 'equipment'), /expected an object/);
  assert.throws(() => readPlayerObject('null', 'quests'), /expected an object/);
});
