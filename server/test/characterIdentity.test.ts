import assert from 'node:assert/strict';
import test from 'node:test';
import { isCharacterGender, readCharacterGender } from '../src/characterIdentity.js';

test('only the two supported character genders are accepted', () => {
  assert.equal(isCharacterGender('male'), true);
  assert.equal(isCharacterGender('female'), true);
  assert.equal(isCharacterGender('other'), false);
  assert.equal(isCharacterGender(undefined), false);
});

test('character gender is read from persisted collections JSON', () => {
  assert.equal(readCharacterGender({ characterGender: 'male' }), 'male');
  assert.equal(readCharacterGender('{"characterGender":"female"}'), 'female');
  assert.equal(readCharacterGender('{}'), null);
  assert.equal(readCharacterGender('not-json'), null);
  assert.equal(readCharacterGender(null), null);
});
