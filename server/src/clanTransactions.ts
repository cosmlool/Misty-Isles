import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type ClanTransactionSnapshot = {
  players: Record<string, unknown>;
  clans: Record<string, unknown>;
  wars: unknown[];
  territories: unknown[];
};

type ClanTransactionOptions = {
  dataDir: string;
  playersFile: string;
  clansFile: string;
  warsFile: string;
  territoriesFile: string;
  testHooks?: {
    afterTargetWrite?: (target: 'players' | 'clans' | 'wars' | 'territories') => void;
  };
};

type Journal = { version: 1; snapshot: ClanTransactionSnapshot };

export function createClanTransactionStore(options: ClanTransactionOptions) {
  const journalFile = join(options.dataDir, 'clan_transaction.json');
  mkdirSync(options.dataDir, { recursive: true });

  function atomicWrite(file: string, value: unknown) {
    const temp = `${file}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
      renameSync(temp, file);
    } catch (error) {
      try { if (existsSync(temp)) unlinkSync(temp); } catch {}
      throw error;
    }
  }

  function validateSnapshot(snapshot: any): asserts snapshot is ClanTransactionSnapshot {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || !snapshot.players || typeof snapshot.players !== 'object' || Array.isArray(snapshot.players)
      || !snapshot.clans || typeof snapshot.clans !== 'object' || Array.isArray(snapshot.clans)
      || !Array.isArray(snapshot.wars) || !Array.isArray(snapshot.territories)
      || Object.values(snapshot.players).some((value: any) => !value || typeof value !== 'object' || Array.isArray(value))
      || Object.values(snapshot.clans).some((value: any) => !value || typeof value !== 'object' || Array.isArray(value))
      || snapshot.wars.some((value: any) => !value || typeof value !== 'object' || Array.isArray(value))
      || snapshot.territories.some((value: any) => !value || typeof value !== 'object' || Array.isArray(value))) {
      throw new Error('Clan transaction snapshot is invalid.');
    }
  }

  function validateJournal(value: any): asserts value is Journal {
    if (!value || value.version !== 1 || !value.snapshot || typeof value.snapshot !== 'object') {
      throw new Error('Clan transaction journal has an unsupported format.');
    }
    validateSnapshot(value.snapshot);
  }

  function apply(snapshot: ClanTransactionSnapshot) {
    // The journal is the commit record. Replaying the same complete snapshot
    // safely finishes a transaction interrupted between any two data files.
    atomicWrite(options.playersFile, snapshot.players);
    options.testHooks?.afterTargetWrite?.('players');
    atomicWrite(options.clansFile, snapshot.clans);
    options.testHooks?.afterTargetWrite?.('clans');
    atomicWrite(options.warsFile, snapshot.wars);
    options.testHooks?.afterTargetWrite?.('wars');
    atomicWrite(options.territoriesFile, snapshot.territories);
    options.testHooks?.afterTargetWrite?.('territories');
  }

  function recover(): boolean {
    if (!existsSync(journalFile)) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(journalFile, 'utf8'));
    } catch (error) {
      throw new Error(`Clan transaction journal is unreadable; refusing to continue: ${String(error)}`);
    }
    validateJournal(parsed);
    apply(parsed.snapshot);
    unlinkSync(journalFile);
    return true;
  }

  function commit(snapshot: ClanTransactionSnapshot) {
    recover();
    validateSnapshot(snapshot);
    atomicWrite(journalFile, { version: 1, snapshot } satisfies Journal);
    try {
      apply(snapshot);
      unlinkSync(journalFile);
    } catch (error) {
      try {
        recover();
      } catch (recoveryError) {
        throw new Error(`Clan transaction could not be fully written; recovery journal was retained: ${String(recoveryError)}`);
      }
    }
  }

  return { commit, recover, journalFile };
}
