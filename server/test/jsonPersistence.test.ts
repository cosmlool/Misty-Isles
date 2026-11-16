import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile } from '../src/jsonPersistence.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'misty-json-persistence-'));
  const file = join(dir, 'accounts.json');
  return { dir, file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a missing persistent JSON file returns its initial default', () => {
  const f = fixture();
  try {
    assert.deepEqual(readJsonFile(f.file, []), []);
  } finally {
    f.cleanup();
  }
});

test('valid JSON is loaded after its structure passes validation', () => {
  const f = fixture();
  try {
    const accounts = [{ username: 'tester', playerId: 'player_123456', createdAt: 1 }];
    writeFileSync(f.file, JSON.stringify(accounts));
    assert.deepEqual(readJsonFile(f.file, [], value => Array.isArray(value)), accounts);
  } finally {
    f.cleanup();
  }
});

test('malformed JSON is rejected and the original bytes remain untouched', () => {
  const f = fixture();
  try {
    const corrupt = '{"account":';
    writeFileSync(f.file, corrupt);
    assert.throws(() => readJsonFile(f.file, []), /invalid JSON/);
    assert.equal(readFileSync(f.file, 'utf8'), corrupt);
  } finally {
    f.cleanup();
  }
});

test('valid JSON with an invalid root structure is rejected without fallback', () => {
  const f = fixture();
  try {
    const invalid = '{"accounts":[]}';
    writeFileSync(f.file, invalid);
    assert.throws(() => readJsonFile(f.file, [], value => Array.isArray(value)), /invalid data structure/);
    assert.equal(readFileSync(f.file, 'utf8'), invalid);
  } finally {
    f.cleanup();
  }
});
