import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/**
 * All files that participate in one logical server-state transaction share
 * one write-ahead journal. The caller prepares its snapshot only after
 * recovery has completed, preventing stale pre-recovery snapshots.
 *
 * This store is intentionally synchronous and supports one server process
 * per data directory. It is not a cross-process lock.
 */
export const SHARED_STATE_KEYS = [
  'players',
  'auction',
  'auctionHistory',
  'clans',
  'wars',
  'territories',
  'mining',
  'huntGroups',
] as const;

export type SharedStateKey = typeof SHARED_STATE_KEYS[number];
export type SharedStateSnapshot = Partial<Record<SharedStateKey, unknown>>;

type Journal = { version: 1; files: SharedStateSnapshot };

type Options = {
  dataDir: string;
  files: Partial<Record<SharedStateKey, string>>;
  testHooks?: {
    afterJournalPersisted?: () => void;
    afterTargetWrite?: (key: SharedStateKey) => void;
  };
};

let lastPlayerBackupTimestamp = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createSharedStateTransactionStore(options: Options) {
  const dataDir = resolve(options.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const journalFile = resolve(dataDir, 'shared_state_transaction.json');
  const configuredFiles = new Map<SharedStateKey, string>();

  for (const key of SHARED_STATE_KEYS) {
    const configured = options.files[key];
    if (!configured) continue;
    const file = resolve(configured);
    const rel = relative(dataDir, file);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || dirname(file) !== dataDir) {
      throw new Error(`Shared-state target "${key}" must be a direct child of the configured data directory.`);
    }
    configuredFiles.set(key, file);
  }

  if (configuredFiles.size === 0) {
    throw new Error('At least one shared-state target file must be configured.');
  }

  function atomicWrite(file: string, value: unknown) {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized === undefined) throw new Error('Shared-state transaction contains a non-serializable value.');
    const temp = `${file}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(temp, serialized, { encoding: 'utf8', flag: 'wx' });
      renameSync(temp, file);
    } catch (error) {
      try { if (existsSync(temp)) unlinkSync(temp); } catch {}
      throw error;
    }
  }

  function validateFiles(files: unknown): asserts files is SharedStateSnapshot {
    if (!isRecord(files) || Object.keys(files).length === 0) {
      throw new Error('Shared-state transaction snapshot must contain at least one target file.');
    }
    for (const [rawKey, value] of Object.entries(files)) {
      if (!(SHARED_STATE_KEYS as readonly string[]).includes(rawKey) || !configuredFiles.has(rawKey as SharedStateKey)) {
        throw new Error(`Shared-state transaction contains an unconfigured target: ${rawKey}.`);
      }
      try {
        if (JSON.stringify(value) === undefined) throw new Error('undefined');
      } catch (error) {
        throw new Error(`Shared-state target "${rawKey}" is not JSON-serializable: ${String(error)}`);
      }
    }
  }

  function validateJournal(value: unknown): asserts value is Journal {
    if (!isRecord(value) || value.version !== 1 || !('files' in value)) {
      throw new Error('Shared-state transaction journal has an unsupported format.');
    }
    validateFiles(value.files);
  }

  function backupPlayersBeforeWrite(target: string) {
    if (!existsSync(target)) return undefined;
    const timestamp = Math.max(Date.now(), lastPlayerBackupTimestamp + 1);
    lastPlayerBackupTimestamp = timestamp;
    const suffix = new Date(timestamp).toISOString().replace(/[:.]/g, '-') + '.' + process.pid + '.' + randomBytes(4).toString('hex');
    const backupFile = target + '.' + suffix + '.bak';
    const backupTemp = backupFile + '.tmp';
    try {
      copyFileSync(target, backupTemp);
      renameSync(backupTemp, backupFile);
      return backupFile;
    } catch (error) {
      try { if (existsSync(backupTemp)) unlinkSync(backupTemp); } catch {}
      throw new Error(`Could not create a backup of players.json; shared-state write cancelled. ${String(error)}`);
    }
  }

  function prunePlayerBackups() {
    try {
      const backups = readdirSync(dataDir).filter(name => /^players\.json\..+\.bak$/.test(name)).sort();
      for (const old of backups.slice(0, Math.max(0, backups.length - 5))) {
        try { unlinkSync(resolve(dataDir, old)); } catch {}
      }
    } catch {}
  }

  function apply(files: SharedStateSnapshot) {
    for (const key of SHARED_STATE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(files, key)) continue;
      const target = configuredFiles.get(key);
      if (!target) throw new Error(`Shared-state target "${key}" is not configured.`);
      if (key === 'players') backupPlayersBeforeWrite(target);
      atomicWrite(target, files[key]);
      if (key === 'players') prunePlayerBackups();
      options.testHooks?.afterTargetWrite?.(key);
    }
  }

  function recover(): boolean {
    if (!existsSync(journalFile)) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(journalFile, 'utf8'));
    } catch (error) {
      throw new Error(`Shared-state transaction journal is unreadable; refusing all writes: ${String(error)}`);
    }
    validateJournal(parsed);
    apply(parsed.files);
    unlinkSync(journalFile);
    return true;
  }

  function transact<T>(prepareAfterRecovery: () => { files: SharedStateSnapshot; result: T; skipWrite?: boolean }): T {
    // Critical ordering: no snapshot is prepared until all prior committed
    // transactions have been replayed successfully.
    recover();
    const prepared = prepareAfterRecovery();
    if (!prepared || typeof prepared !== 'object') {
      throw new Error('Shared-state transaction preparation returned an invalid result.');
    }
    if (prepared.skipWrite) return prepared.result;
    validateFiles(prepared.files);
    const journal: Journal = { version: 1, files: prepared.files };
    atomicWrite(journalFile, journal);

    try {
      options.testHooks?.afterJournalPersisted?.();
      apply(prepared.files);
      unlinkSync(journalFile);
    } catch (error) {
      // A successful replay means the journaled transaction committed despite
      // the interrupted first attempt. If replay fails, keep the journal and
      // fail closed; the next writer will retry recovery before preparing.
      try {
        recover();
      } catch (recoveryError) {
        throw new Error(`Shared-state transaction could not be recovered; journal retained and writes blocked: ${String(recoveryError)}`);
      }
    }
    return prepared.result;
  }

  return { transact, recover, journalFile };
}
