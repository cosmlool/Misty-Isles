import { closeSync, existsSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

type Options = {
  platform?: NodeJS.Platform;
  testHooks?: {
    afterFileSync?: (path: string) => void;
    afterRename?: (path: string) => void;
    afterDirectorySync?: (path: string) => void;
  };
};

/**
 * Atomically replace one JSON file and request durable file/directory metadata.
 * Windows does not support the directory-descriptor fsync used on POSIX.
 */
export function writeJsonFileAtomic(file: string, value: unknown, options: Options = {}): void {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new Error('JSON persistence value is not serializable.');
  const temp = `${file}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, serialized, { encoding: 'utf8', flag: 'wx' });
    const descriptor = openSync(temp, 'r+');
    try {
      fsyncSync(descriptor);
      options.testHooks?.afterFileSync?.(temp);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temp, file);
    options.testHooks?.afterRename?.(file);
    if ((options.platform ?? process.platform) !== 'win32') {
      const directory = dirname(file);
      const directoryDescriptor = openSync(directory, 'r');
      try {
        fsyncSync(directoryDescriptor);
        options.testHooks?.afterDirectorySync?.(directory);
      } finally {
        closeSync(directoryDescriptor);
      }
    }
  } catch (error) {
    try { if (existsSync(temp)) unlinkSync(temp); } catch {}
    throw error;
  }
}
