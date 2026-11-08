import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
