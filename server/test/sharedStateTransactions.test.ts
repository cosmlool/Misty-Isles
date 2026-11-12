import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSharedStateTransactionStore } from '../src/sharedStateTransactions.js';
import { createAuctionTransactionStore } from '../src/auctionTransactions.js';
import { createClanTransactionStore } from '../src/clanTransactions.js';

function fixture(testHooks?: any) {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-shared-state-'));
  const files = {
    players: join(dataDir, 'players.json'),
    auction: join(dataDir, 'auction.json'),
    auctionHistory: join(dataDir, 'auction_history.json'),
    clans: join(dataDir, 'clans.json'),
    wars: join(dataDir, 'clan_wars.json'),
    territories: join(dataDir, 'clan_territories.json'),
  };
  return {
    dataDir, files,
    store: createSharedStateTransactionStore({ dataDir, files, testHooks }),
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}
function readJson(file: string) { return JSON.parse(readFileSync(file, 'utf8')); }

test('one journal atomically applies a transaction spanning player, auction and clan state', () => {
  const f = fixture();
  try {
    const result = f.store.transact(() => ({
      files: {
        players: { p1: { gold: 10 } },
        auction: [{ id: 'lot_1' }],
        clans: { c1: { vault: 20 } },
      },
      result: 'committed',
    }));
    assert.equal(result, 'committed');
    assert.deepEqual(readJson(f.files.players), { p1: { gold: 10 } });
    assert.deepEqual(readJson(f.files.auction), [{ id: 'lot_1' }]);
    assert.deepEqual(readJson(f.files.clans), { c1: { vault: 20 } });
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});

test('a recovered no-op transaction skips journal, player backup and target writes', () => {
  const f = fixture();
  try {
    writeFileSync(f.files.players, JSON.stringify({ p1: { gold: 15 } }));
    const result = f.store.transact(() => ({ files: {}, result: 'unchanged', skipWrite: true }));
    assert.equal(result, 'unchanged');
    assert.deepEqual(readJson(f.files.players), { p1: { gold: 15 } });
    assert.equal(existsSync(f.store.journalFile), false);
    assert.equal(readdirSync(f.dataDir).filter(name => /^players\.json\..+\.bak$/.test(name)).length, 0);
  } finally { f.cleanup(); }
});

test('snapshot preparation runs only after a pending journal has been recovered', () => {
  const f = fixture();
  try {
    writeFileSync(f.store.journalFile, JSON.stringify({
      version: 1,
      files: { players: { p1: { gold: 80 } }, auction: [{ id: 'recovered_lot' }] },
    }));
    writeFileSync(f.files.players, JSON.stringify({ p1: { gold: 5 } }));
    let observedGold = 0;
    f.store.transact(() => {
      observedGold = readJson(f.files.players).p1.gold;
      return { files: { players: { p1: { gold: observedGold - 10 } } }, result: undefined };
    });
    assert.equal(observedGold, 80);
    assert.deepEqual(readJson(f.files.players), { p1: { gold: 70 } });
    assert.deepEqual(readJson(f.files.auction), [{ id: 'recovered_lot' }]);
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});

test('a process crash between target writes is replayed from the single shared journal', () => {
  const f = fixture();
  try {
    const moduleUrl = new URL('../src/sharedStateTransactions.ts', import.meta.url).href;
    const childScript = `
      import { createSharedStateTransactionStore } from ${JSON.stringify(moduleUrl)};
      const store = createSharedStateTransactionStore({
        dataDir: ${JSON.stringify(f.dataDir)},
        files: ${JSON.stringify(f.files)},
        testHooks: { afterTargetWrite(key) { if (key === 'auction') process.exit(73); } },
      });
      store.transact(() => ({ files: {
        players: { p1: { gold: 30 } },
        auction: [{ id: 'new_lot' }],
        clans: { c1: { vault: 40 } },
      }, result: null }));
      process.exit(0);
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childScript], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(child.status, 73);
    assert.equal(existsSync(f.store.journalFile), true);
    assert.deepEqual(readJson(f.files.players), { p1: { gold: 30 } });
    assert.deepEqual(readJson(f.files.auction), [{ id: 'new_lot' }]);
    assert.equal(existsSync(f.files.clans), false);

    const restarted = createSharedStateTransactionStore({ dataDir: f.dataDir, files: f.files });
    assert.equal(restarted.recover(), true);
    assert.deepEqual(readJson(f.files.players), { p1: { gold: 30 } });
    assert.deepEqual(readJson(f.files.auction), [{ id: 'new_lot' }]);
    assert.deepEqual(readJson(f.files.clans), { c1: { vault: 40 } });
    assert.equal(existsSync(restarted.journalFile), false);
    assert.equal(restarted.recover(), false);
  } finally { f.cleanup(); }
});

test('startup migration recovery replays legacy journals before the newer shared journal', () => {
  const f = fixture();
  try {
    const auction = createAuctionTransactionStore({
      dataDir: f.dataDir, playersFile: f.files.players,
      auctionFile: f.files.auction, historyFile: f.files.auctionHistory,
    });
    const clans = createClanTransactionStore({
      dataDir: f.dataDir, playersFile: f.files.players,
      clansFile: f.files.clans, warsFile: f.files.wars,
      territoriesFile: f.files.territories,
    });

    writeFileSync(auction.journalFile, JSON.stringify({
      version: 1,
      snapshot: { players: { p1: { gold: 10 } }, auction: [{ id: 'legacy_lot' }], history: [] },
    }));
    writeFileSync(clans.journalFile, JSON.stringify({
      version: 1,
      snapshot: {
        players: { p1: { gold: 20 } }, clans: { c1: { vault: 1 } },
        wars: [], territories: [],
      },
    }));
    writeFileSync(f.store.journalFile, JSON.stringify({
      version: 1,
      files: {
        players: { p1: { gold: 30 } }, auction: [{ id: 'shared_lot' }],
        auctionHistory: [{ id: 'shared_tx' }], clans: { c1: { vault: 2 } },
      },
    }));

    assert.equal(auction.recover(), true);
    assert.equal(clans.recover(), true);
    assert.equal(f.store.recover(), true);

    assert.equal(readJson(f.files.players).p1.gold, 30);
    assert.deepEqual(readJson(f.files.auction), [{ id: 'shared_lot' }]);
    assert.deepEqual(readJson(f.files.auctionHistory), [{ id: 'shared_tx' }]);
    assert.deepEqual(readJson(f.files.clans), { c1: { vault: 2 } });
    assert.equal(existsSync(auction.journalFile), false);
    assert.equal(existsSync(clans.journalFile), false);
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});

test('corrupt or unconfigured journal entries fail closed and preserve the journal', () => {
  const f = fixture();
  try {
    writeFileSync(f.store.journalFile, '{broken');
    assert.throws(() => f.store.transact(() => ({
      files: { players: { p1: { gold: 1 } } }, result: null,
    })), /unreadable; refusing all writes/);
    assert.equal(existsSync(f.store.journalFile), true);
    assert.equal(existsSync(f.files.players), false);

    writeFileSync(f.store.journalFile, JSON.stringify({
      version: 1, files: { unknownFile: { unsafe: true } },
    }));
    assert.throws(() => f.store.recover(), /unconfigured target/);
    assert.equal(existsSync(f.store.journalFile), true);
  } finally { f.cleanup(); }
});

test('target write failure retains the journal and blocks a later transaction until recovery succeeds', () => {
  const f = fixture();
  try {
    // A directory at the target path forces atomic rename to fail.
    const blockedDir = join(f.dataDir, 'clans.json');
    mkdirSync(blockedDir);
    assert.throws(() => f.store.transact(() => ({
      files: { players: { p1: { gold: 5 } }, clans: { c1: {} } }, result: null,
    })), /could not be recovered; journal retained/);
    assert.equal(existsSync(f.store.journalFile), true);
    assert.throws(() => f.store.transact(() => ({
      files: { players: { p1: { gold: 999 } } }, result: null,
    })), /could not be recovered|could not be applied|EISDIR|ENOTDIR/);
    rmSync(blockedDir, { recursive: true, force: true });
    const recovered = createSharedStateTransactionStore({ dataDir: f.dataDir, files: f.files });
    assert.equal(recovered.recover(), true);
    assert.deepEqual(readJson(f.files.players), { p1: { gold: 5 } });
    assert.deepEqual(readJson(f.files.clans), { c1: {} });
  } finally { f.cleanup(); }
});


test('shared player writes preserve the previous save in a backup', () => {
  const f = fixture();
  try {
    writeFileSync(f.files.players, JSON.stringify({ p1: { gold: 15 } }));
    f.store.transact(() => ({ files: { players: { p1: { gold: 25 } } }, result: null }));
    assert.deepEqual(readJson(f.files.players), { p1: { gold: 25 } });
    const backups = readdirSync(f.dataDir).filter(name => /^players\.json\..+\.bak$/.test(name));
    assert.equal(backups.length, 1);
    assert.deepEqual(readJson(join(f.dataDir, backups[0])), { p1: { gold: 15 } });
  } finally { f.cleanup(); }
});

test('shared player write fails closed when its backup cannot be created', () => {
  const f = fixture();
  try {
    mkdirSync(f.files.players);
    assert.throws(() => f.store.transact(() => ({
      files: { players: { p1: { gold: 50 } } }, result: null,
    })), /could not be recovered; journal retained and writes blocked/);
    assert.equal(existsSync(f.store.journalFile), true);
    assert.equal(readdirSync(f.files.players).length, 0);
  } finally { f.cleanup(); }
});

test('shared player writes retain only the newest five backups', () => {
  const f = fixture();
  try {
    writeFileSync(f.files.players, JSON.stringify({ p1: { gold: 0 } }));
    for (let gold = 1; gold <= 7; gold++) {
      f.store.transact(() => ({ files: { players: { p1: { gold } } }, result: null }));
    }
    const backups = readdirSync(f.dataDir).filter(name => /^players\.json\..+\.bak$/.test(name)).sort();
    assert.equal(backups.length, 5);
    const values = backups.map(name => readJson(join(f.dataDir, name)).p1.gold);
    assert.ok(values.includes(2));
    assert.ok(values.includes(6));
    assert.ok(!values.includes(0));
    assert.ok(!values.includes(1));
  } finally { f.cleanup(); }
});
