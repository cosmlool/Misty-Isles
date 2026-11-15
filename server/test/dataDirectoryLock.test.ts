import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireDataDirectoryLock } from '../src/dataDirectoryLock.js';

test('data directory lock is exclusive and releases only its owner token', () => {
  const directory = mkdtempSync(join(tmpdir(), 'misty-data-lock-'));
  const lockFile = join(directory, '.misty-server.lock');
  try {
    const release = acquireDataDirectoryLock(directory);
    const record = JSON.parse(readFileSync(lockFile, 'utf8'));
    assert.equal(record.version, 1);
    assert.equal(record.pid, process.pid);
    assert.match(record.token, /^[a-f0-9]{48}$/);
    assert.throws(() => acquireDataDirectoryLock(directory), /already locked/);
    assert.equal(existsSync(lockFile), true);
    release();
    release();
    assert.equal(existsSync(lockFile), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('data directory lock refuses to auto-delete stale or malformed records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'misty-stale-lock-'));
  const lockFile = join(directory, '.misty-server.lock');
  try {
    writeFileSync(lockFile, JSON.stringify({
      version: 1, pid: 999999999, startedAt: '2000-01-01T00:00:00.000Z', token: 'stale',
    }));
    assert.throws(() => acquireDataDirectoryLock(directory), /already locked/);
    assert.equal(existsSync(lockFile), true);
    writeFileSync(lockFile, '{incomplete');
    assert.throws(() => acquireDataDirectoryLock(directory), /already locked/);
    assert.equal(readFileSync(lockFile, 'utf8'), '{incomplete');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
