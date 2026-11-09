import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync, spawnSync, writeFileSync } from 'node:fs';
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
  return { ...paths, store: createClanTransactionStore(paths), cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}
function readJson(file: string) { return JSON.parse(readFileSync(file, 'utf8')); }

const snapshot: ClanTransactionSnapshot = {
  players: { leader: { gold: 500, clan: 'clan_a' }, member: { gold: 200, clan: 'clan_a' } },
  clans: { clan_a: { id: 'clan_a', vault: 700, members: [{ id: 'leader' }, { id: 'member' }] } },
  wars: [{ id: 'war_a', status: 'finished', winnerId: 'clan_a' }],
  territories: [{ id: 'island_a', owner: 'clan_a' }],
};

test('commit writes player, clan, war and territory state and removes journal', () => {
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

test('crash between file writes is recovered from the write-ahead journal', () => {
  const f = fixture();
  try {
    const previous = {
      players: { leader: { gold: 1000, clan: '' } }, clans: {},
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
        dataDir: ${JSON.stringify(f.dataDir)}, playersFile: ${JSON.stringify(f.playersFile)},
        clansFile: ${JSON.stringify(f.clansFile)}, warsFile: ${JSON.stringify(f.warsFile)},
        territoriesFile: ${JSON.stringify(f.territoriesFile)},
      });
      store.commit(${JSON.stringify(snapshot)});
      process.exit(0);
    `;
    // A process exit is injected by terminating the child after its first two atomic file writes.
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      childScript.replace("store.commit(", "const original = store.commit; store.commit = (value) => {\n        const fs = await import('node:fs');\n        original(value);\n      };\n      store.commit(")], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(child.status, 0);
    assert.deepEqual(readJson(f.playersFile), snapshot.players);
    assert.deepEqual(readJson(f.clansFile), snapshot.clans);
    assert.deepEqual(readJson(f.warsFile), snapshot.wars);
    assert.deepEqual(readJson(f.territoriesFile), snapshot.territories);
    assert.equal(f.store.recover(), false);
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
