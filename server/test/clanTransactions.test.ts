import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClanTransactionStore, type ClanTransactionSnapshot } from '../src/clanTransactions.js';

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-clan-transaction-'));
  const paths = {
    dataDir,
    playersFile: join(dataDir, 'players.json'),
    clansFile: join(dataDir, 'clans.json'),
    warsFile: join(dataDir, 'clan_wars.json'),
    territoriesFile: join(dataDir, 'clan_territories.json'),
  };
  const store = createClanTransactionStore(paths);
  return { ...paths, store, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

function readJson(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const snapshot: ClanTransactionSnapshot = {
  players: { leader: { gold: 500, clan: 'clan_a' }, member: { gold: 200, clan: 'clan_a' } },
  clans: { clan_a: { id: 'clan_a', vault: 700, members: [{ id: 'leader' }, { id: 'member' }] } },
  wars: [{ id: 'war_a', status: 'finished', winnerId: 'clan_a' }],
  territories: [{ id: 'island_a', owner: 'clan_a' }],
};

test('commit atomically records player, clan, war and territory state', () => {
  const f = fixture();
  try {
    f.store.commit(snapshot);
    assert.deepEqual(readJson(f.playersFile), snapshot.players);
    assert.deepEqual(readJson(f.clansFile), snapshot.clans);
    assert.deepEqual(readJson(f.warsFile), snapshot.wars);
    assert.deepEqual(readJson(f.territoriesFile), snapshot.territories);
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});

test('process crash between clan files is recovered from the write-ahead journal', () => {
  const f = fixture();
  try {
    const previous = {
      players: { leader: { gold: 1000, clan: '' } },
      clans: {},
      wars: [{ id: 'war_old', status: 'active' }],
      territories: [{ id: 'island_a', owner: '' }],
    };
    writeFileSync(f.playersFile, JSON.stringify(previous.players));
    writeFileSync(f.clansFile, JSON.stringify(previous.clans));
    writeFileSync(f.warsFile, JSON.stringify(previous.wars));
    writeFileSync(f.territoriesFile, JSON.stringify(previous.territories));

    const moduleUrl = new URL('../src/clanTransactions.ts', import.meta.url).href;
    const childScript = `
      import { createClanTransactionStore } from ${JSON.stringify(moduleUrl)};
      const store = createClanTransactionStore({
        dataDir: ${JSON.stringify(f.dataDir)},
        playersFile: ${JSON.stringify(f.playersFile)},
        clansFile: ${JSON.stringify(f.clansFile)},
        warsFile: ${JSON.stringify(f.warsFile)},
        territoriesFile: ${JSON.stringify(f.territoriesFile)},
        testHooks: {
          afterTargetWrite(target) {
            if (target === 'clans') process.exit(73);
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

    assert.equal(child.status, 73, 'child process must stop at the injected crash point');
    assert.equal(existsSync(f.store.journalFile), true, 'journal must survive process termination');
    assert.deepEqual(readJson(f.playersFile), snapshot.players);
    assert.deepEqual(readJson(f.clansFile), snapshot.clans);
    assert.deepEqual(readJson(f.warsFile), previous.wars, 'later files remain pre-transaction until recovery');
    assert.deepEqual(readJson(f.territoriesFile), previous.territories);

    const restarted = createClanTransactionStore(f);
    assert.equal(restarted.recover(), true);
    assert.deepEqual(readJson(f.playersFile), snapshot.players);
    assert.deepEqual(readJson(f.clansFile), snapshot.clans);
    assert.deepEqual(readJson(f.warsFile), snapshot.wars);
    assert.deepEqual(readJson(f.territoriesFile), snapshot.territories);
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});

test('invalid snapshots are rejected before a journal is written', () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.commit({ players: [], clans: {}, wars: [], territories: [] } as any), /snapshot is invalid/);
    assert.equal(existsSync(f.store.journalFile), false);
  } finally { f.cleanup(); }
});

test('unreadable journals are retained and block recovery', () => {
  const f = fixture();
  try {
    writeFileSync(f.store.journalFile, '{broken');
    assert.throws(() => f.store.recover(), /journal is unreadable/);
    assert.equal(existsSync(f.store.journalFile), true);
  } finally { f.cleanup(); }
});

test('legacy clan recovery fsyncs target publication and journal removal', () => {
  const f = fixture();
  try {
    const events: string[] = [];
    const store = createClanTransactionStore({
      ...f,
      testHooks: { afterSync: path => events.push(path) },
    });
    writeFileSync(f.store.journalFile, JSON.stringify({ version: 1, snapshot }));
    assert.equal(store.recover(), true);
    const playerTempSync = events.findIndex(path => path.startsWith(f.playersFile + '.'));
    const firstDirectorySync = events.indexOf(f.dataDir);
    assert.ok(playerTempSync >= 0, 'recovered player snapshot temp file must be fsynced');
    assert.ok(firstDirectorySync > playerTempSync, 'target directory entry must be fsynced after rename');
    assert.equal(events.at(-1), f.dataDir, 'journal removal must be followed by a directory fsync');
  } finally { f.cleanup(); }
});
