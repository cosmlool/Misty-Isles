import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type AuctionSnapshot = {
  players: Record<string, unknown>;
  auction: unknown[];
  history: unknown[];
};

type AuctionTransactionOptions = {
  dataDir: string;
  playersFile: string;
  auctionFile: string;
  historyFile: string;
  // Fault-injection seam used only by isolated crash-recovery tests.
  testHooks?: {
    afterJournalPersisted?: () => void;
    afterTargetWrite?: (target: 'players' | 'auction' | 'history') => void;
  };
};

type Journal = { version: 1; snapshot: AuctionSnapshot };

export function createAuctionTransactionStore(options: AuctionTransactionOptions) {
  const journalFile = join(options.dataDir, 'auction_transaction.json');
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

  function validateJournal(value: any): asserts value is Journal {
    if (!value || value.version !== 1 || !value.snapshot || typeof value.snapshot !== 'object') {
      throw new Error('Auction transaction journal has an unsupported format.');
    }
    const snapshot = value.snapshot;
    if (!snapshot.players || typeof snapshot.players !== 'object' || Array.isArray(snapshot.players)
      || !Array.isArray(snapshot.auction) || !Array.isArray(snapshot.history)
      || Object.values(snapshot.players).some((player: any) => !player || typeof player !== 'object' || Array.isArray(player))) {
      throw new Error('Auction transaction journal contains an invalid snapshot.');
    }
  }

  function apply(snapshot: AuctionSnapshot) {
    // The journal is the write-ahead commit record. Startup recovery can safely
    // repeat these atomic replacements if the process stops between files.
    atomicWrite(options.playersFile, snapshot.players);
    options.testHooks?.afterTargetWrite?.('players');
    atomicWrite(options.auctionFile, snapshot.auction);
    options.testHooks?.afterTargetWrite?.('auction');
    atomicWrite(options.historyFile, snapshot.history);
    options.testHooks?.afterTargetWrite?.('history');
  }

  function recover(): boolean {
    if (!existsSync(journalFile)) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(journalFile, 'utf8'));
    } catch (error) {
      throw new Error(`Auction transaction journal is unreadable; refusing to continue: ${String(error)}`);
    }
    validateJournal(parsed);
    apply(parsed.snapshot);
    unlinkSync(journalFile);
    return true;
  }

  function commit(snapshot: AuctionSnapshot) {
    recover();
    if (!snapshot.players || typeof snapshot.players !== 'object' || Array.isArray(snapshot.players)
      || !Array.isArray(snapshot.auction) || !Array.isArray(snapshot.history)
      || Object.values(snapshot.players).some((player: any) => !player || typeof player !== 'object' || Array.isArray(player))) {
      throw new Error('Refusing to commit an invalid auction transaction snapshot.');
    }
    const journal: Journal = { version: 1, snapshot };
    atomicWrite(journalFile, journal);
    try {
      options.testHooks?.afterJournalPersisted?.();
      apply(snapshot);
      unlinkSync(journalFile);
    } catch (error) {
      // Retry the complete snapshot immediately. If storage is still failing,
      // keep the journal so the next startup can finish the transaction.
      try {
        recover();
      } catch (recoveryError) {
        throw new Error(`Auction transaction could not be fully written; recovery journal was retained: ${String(recoveryError)}`);
      }
    }
  }

  return { commit, recover, journalFile };
}
