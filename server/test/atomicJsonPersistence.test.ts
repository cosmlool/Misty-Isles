import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeJsonFileAtomic } from '../src/atomicJsonPersistence.js';

test('atomic JSON persistence syncs file contents before rename and directory metadata after rename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'misty-auth-persistence-'));
  try {
    const file = join(dir, 'accounts.json');
    writeFileSync(file, JSON.stringify([{ username: 'old' }]));
    const events: string[] = [];
    writeJsonFileAtomic(file, [{ username: 'new' }], {
      platform: 'linux',
      testHooks: {
        afterFileSync(path) { events.push('file:' + path); },
        afterRename(path) { events.push('rename:' + path); },
        afterDirectorySync(path) { events.push('directory:' + path); },
      },
    });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), [{ username: 'new' }]);
    assert.equal(events.length, 3);
    assert.ok(events[0].startsWith('file:'), 'temporary file contents must be synced first');
    assert.equal(events[1], 'rename:' + file, 'the complete file is atomically published second');
    assert.equal(events[2], 'directory:' + dir, 'the containing directory is synced last');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file sync failure leaves the previous authentication snapshot untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'misty-auth-persistence-'));
  try {
    const file = join(dir, 'sessions.json');
    writeFileSync(file, JSON.stringify([{ tokenHash: 'old' }]));
    assert.throws(() => writeJsonFileAtomic(file, [{ tokenHash: 'new' }], {
      testHooks: { afterFileSync() { throw new Error('simulated file sync failure'); } },
    }), /simulated file sync failure/);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), [{ tokenHash: 'old' }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Windows skips unsupported directory fsync while still syncing file contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'misty-auth-persistence-'));
  try {
    const file = join(dir, 'guest_credentials.json');
    const events: string[] = [];
    writeJsonFileAtomic(file, [{ playerId: 'guest_test' }], {
      platform: 'win32',
      testHooks: {
        afterFileSync(path) { events.push('file:' + path); },
        afterDirectorySync(path) { events.push('directory:' + path); },
      },
    });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), [{ playerId: 'guest_test' }]);
    assert.equal(events.length, 1);
    assert.ok(events[0].startsWith('file:'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
