import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Read a persistent JSON file without treating corruption or I/O failures as
 * an empty store. Only a genuinely missing file may use the supplied default.
 */
export function readJsonFile<T>(
  file: string,
  fallback: T,
  validate?: (value: unknown) => boolean,
): T {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${basename(file)}; refusing to replace existing data. ${String(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${basename(file)} contains invalid JSON; refusing to replace existing data. ${String(error)}`);
  }

  if (validate && !validate(value)) {
    throw new Error(`${basename(file)} has an invalid data structure; refusing to replace existing data.`);
  }
  return value as T;
}
