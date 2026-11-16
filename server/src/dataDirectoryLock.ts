import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type LockRecord = {
  version: 1;
  pid: number;
  startedAt: string;
  token: string;
};

export function acquireDataDirectoryLock(dataDirectory: string): () => void {
  const directory = resolve(dataDirectory);
  mkdirSync(directory, { recursive: true });
  const lockFile = join(directory, '.misty-server.lock');
  const token = randomBytes(24).toString('hex');
  const record: LockRecord = { version: 1, pid: process.pid, startedAt: new Date().toISOString(), token };

  let descriptor: number;
  try {
    descriptor = openSync(lockFile, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let owner = 'owner metadata is unreadable';
    try {
      const existing = JSON.parse(readFileSync(lockFile, 'utf8')) as Partial<LockRecord>;
      if (existing.version === 1 && Number.isInteger(existing.pid) && typeof existing.startedAt === 'string') {
        owner = `PID ${existing.pid}, started ${existing.startedAt}`;
      } else {
        owner = 'lock metadata is malformed';
      }
    } catch {
      // Partial lock files fail closed and require operator inspection.
    }
    throw new Error(
      `Misty-Isles data directory is already locked (${owner}): ${directory}. ` +
      'Do not delete .misty-server.lock while a server may be running. ' +
      'After confirming that no Misty-Isles server uses this directory, remove the stale lock file manually.',
    );
  }

  try {
    writeFileSync(descriptor, JSON.stringify(record), 'utf8');
    fsyncSync(descriptor);
  } catch (error) {
    try { closeSync(descriptor); } catch {}
    try { unlinkSync(lockFile); } catch {}
    throw error;
  }
  closeSync(descriptor);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const current = JSON.parse(readFileSync(lockFile, 'utf8')) as Partial<LockRecord>;
      if (current.version === 1 && current.pid === record.pid && current.token === token) unlinkSync(lockFile);
    } catch {
      // Never remove a lock that cannot be proven to belong to this process.
    }
  };
}
