import assert from 'node:assert/strict';
import test from 'node:test';
import { isPasswordLengthWithinLimit } from '../src/authPasswordPolicy.js';

test('login password policy accepts the registration maximum', () => {
  assert.equal(isPasswordLengthWithinLimit('x'.repeat(128)), true);
});

test('login password policy rejects oversized input before password hashing', () => {
  assert.equal(isPasswordLengthWithinLimit('x'.repeat(129)), false);
  assert.equal(isPasswordLengthWithinLimit('x'.repeat(8192)), false);
});
