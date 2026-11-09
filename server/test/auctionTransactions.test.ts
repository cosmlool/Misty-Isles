import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAuctionTransactionStore, type AuctionSnapshot } from '../src/auctionTransactions.js';

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-auction-'));
  const paths = {
    dataDir,
    playersFile: join(dataDir, 'players.json'),
    auctionFile: join(dataDir, 'auction.json'),
    historyFile: join(dataDir, 'auction_history.json'),
  };
  const store = createAuctionTransactionStore(paths);
  return { ...paths, store, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

function readJson(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const snapshot: AuctionSnapshot = {
  players: { buyer: { gold: 40, inventory: ['item_a'] }, seller: { gold: 95, inventory: [] } },
  auction: [],
  history: [{ id: 'tx_1', status: 'completed' }],
};

test('commit atomically records the complete auction snapshot and removes the journal', () => {
  const f = fixture();
  try {
    f.store.commit(snapshot);
    assert.deepEqual(readJson(f.playersFile), snapshot.players);
    assert.deepEqual(readJson(f.auctionFile), snapshot.auction);
    assert.deepEqual(readJson(f.historyFile), snapshot.history);
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});

test('process crash after the first target write is recovered exactly once from the WAL', () => {
  const f = fixture();
  try {
    const previous = {
      players: { buyer: { gold: 100, inventory: [] }, seller: { gold: 0, inventory: ['item_a'] } },
      auction: [{ id: 'old_lot', itemId: 'item_old' }],
      history: [{ id: 'old_tx', status: 'completed' }],
    };
    writeFileSync(f.playersFile, JSON.stringify(previous.players));
    writeFileSync(f.auctionFile, JSON.stringify(previous.auction));
    writeFileSync(f.historyFile, JSON.stringify(previous.history));

    const moduleUrl = new URL('../src/auctionTransactions.ts', import.meta.url).href;
    const childScript = `
      import { createAuctionTransactionStore } from ${JSON.stringify(moduleUrl)};
      const store = createAuctionTransactionStore({
        dataDir: ${JSON.stringify(f.dataDir)},
        playersFile: ${JSON.stringify(f.playersFile)},
        auctionFile: ${JSON.stringify(f.auctionFile)},
        historyFile: ${JSON.stringify(f.historyFile)},
        testHooks: {
          afterTargetWrite(target) {
            if (target === 'players') process.exit(73);
          },
        },
      });
      store.commit(${JSON.stringify(snapshot)});
      process.exit(0);
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childScript], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10_000,
    });

    assert.equal(child.status, 73, 'child process must terminate at the injected crash point');
    assert.equal(existsSync(f.store.journalFile), true, 'write-ahead journal must survive process termination');
    assert.deepEqual(readJson(f.playersFile), snapshot.players, 'first target may already contain the committed snapshot');
    assert.deepEqual(readJson(f.auctionFile), previous.auction, 'later targets must still show their pre-transaction state');
    assert.deepEqual(readJson(f.historyFile), previous.history, 'history must still show its pre-transaction state');

    const restartedStore = createAuctionTransactionStore({
      dataDir: f.dataDir,
      playersFile: f.playersFile,
      auctionFile: f.auctionFile,
      historyFile: f.historyFile,
    });
    assert.equal(restartedStore.recover(), true);
    assert.deepEqual(readJson(f.playersFile), snapshot.players);
    assert.deepEqual(readJson(f.auctionFile), snapshot.auction);
    assert.deepEqual(readJson(f.historyFile), snapshot.history);
    assert.equal(existsSync(f.store.journalFile), false);

    assert.equal(readJson(f.playersFile).buyer.inventory.filter((id: string) => id === 'item_a').length, 1);
    assert.equal(readJson(f.playersFile).seller.inventory.length, 0);
    assert.equal(readJson(f.historyFile).filter((entry: { id: string }) => entry.id === 'tx_1').length, 1);
  } finally { f.cleanup(); }
});

test('startup recovery replays a journal left by an interrupted multi-file write', () => {
  const f = fixture();
  try {
    writeFileSync(f.store.journalFile, JSON.stringify({ version: 1, snapshot }));
    assert.equal(f.store.recover(), true);
    assert.deepEqual(readJson(f.playersFile), snapshot.players);
    assert.deepEqual(readJson(f.auctionFile), snapshot.auction);
    assert.deepEqual(readJson(f.historyFile), snapshot.history);
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});

test('failed target write retains the journal and can be recovered after storage is repaired', () => {
  const f = fixture();
  try {
    mkdirSync(f.auctionFile);
    assert.throws(() => f.store.commit(snapshot), /could not be fully written/);
    assert.equal(existsSync(f.store.journalFile), true);
    rmSync(f.auctionFile, { recursive: true, force: true });
    assert.equal(f.store.recover(), true);
    assert.deepEqual(readJson(f.playersFile), snapshot.players);
    assert.deepEqual(readJson(f.auctionFile), snapshot.auction);
    assert.deepEqual(readJson(f.historyFile), snapshot.history);
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});

test('invalid or unreadable journal blocks recovery instead of silently discarding it', () => {
  const f = fixture();
  try {
    writeFileSync(f.store.journalFile, '{broken');
    assert.throws(() => f.store.recover(), /journal is unreadable/);
    assert.equal(existsSync(f.store.journalFile), true);
  } finally { f.cleanup(); }
});

test('commit rejects malformed snapshots before writing a journal', () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.commit({ players: [] as any, auction: [], history: [] }), /invalid auction transaction/);
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});
