import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

test('production runtime has no direct player or legacy subsystem writer bypasses', () => {
  for (const pattern of [
    /\bsavePlayers\s*\(/,
    /\b(?:auctionTransactions|clanTransactions)\.commit\s*\(/,
    /\b(?:saveClans|saveTerritories|saveAuction|saveAuctionHistory|saveWars)\s*\(/,
  ]) {
    assert.equal(pattern.test(source), false, 'forbidden direct persistence writer found: ' + pattern);
  }
});

test('player, auction and clan mutations are routed through the shared transaction coordinator', () => {
  assert.match(source, /sharedStateRuntime\.transact\s*\(/);
  assert.match(source, /sharedStateRuntime\.commitAuction\s*\(/);
  assert.match(source, /sharedStateRuntime\.commitClan\s*\(/);
});

test('startup recovery finishes before hunt-group restore and autosave startup', () => {
  const recovery = source.indexOf('sharedStateRuntime.recoverPendingState();');
  const groupRestore = source.indexOf('restoreHuntGroupsFromDisk();');
  const autosave = source.indexOf('startPlayerAutosave({');
  assert.ok(recovery >= 0, 'startup recovery gate must exist');
  assert.ok(groupRestore > recovery, 'group restore must happen after recovery');
  assert.ok(autosave > recovery, 'autosave must start after recovery');
});

test('player persistence failures reconcile live state with the last durable snapshot', () => {
  assert.match(source, /function reconcileOnlinePlayersAfterPersistenceFailure\s*\(/);
  assert.match(source, /catch\(error\)\{reconcileOnlinePlayersAfterPersistenceFailure\(\);throw error;\}/);
  assert.match(source, /function persistDungeonResultPlayers[\s\S]*?rollbackSnapshots/);
  assert.match(source, /const rollbackSnapshots=players\.map\(player=>player!\.toJSON\(\)\)/);
  assert.equal((source.match(/persistDungeonResultPlayers\(players as Player\[\],dungeonResultEvents,rollbackSnapshots\)/g) || []).length, 2);
  assert.match(source, /if\(journalPending\)[\s\S]*?reconcileOnlinePlayersAfterPersistenceFailure\(\)[\s\S]*?else\{[\s\S]*?applyPlayerSave\(players\[i\] as any,rollbackSnapshots\[i\]\)/);
  assert.match(source, /function transactClanMutation[\s\S]*?catch\(error\)\{reconcileOnlinePlayersAfterPersistenceFailure\(\);throw error;\}/);
});

test('room leave does not overwrite persistence recovery with a stale quest snapshot', () => {
  const start = source.indexOf('  onLeave(client: Client)');
  const end = source.indexOf('  onDispose()', start);
  assert.ok(start >= 0 && end > start, 'room leave lifecycle must be present');
  const leave = source.slice(start, end);
  assert.match(leave, /persistPlayers\(affectedPlayers\.length\?affectedPlayers:\[this\.state\.player\]\)/);
  assert.doesNotMatch(leave, /previousQuests|catch\(error\)[\s\S]*?player\.quests=previous/);
});

test('local save directory does not redirect bundled static game data', () => {
  assert.match(source, /const GAME_DATA_DIR = join\(process\.cwd\(\), 'data'\)/);
  for (const filename of ['forgotten_lands.json', 'city_npcs.json', 'equipment_catalog.json']) {
    assert.ok(source.includes(`join(GAME_DATA_DIR,'${filename}')`), filename + ' must load from bundled server/data');
    assert.equal(source.includes(`join(DATA_DIR,'${filename}')`), false, filename + ' must not load from the isolated save directory');
  }
  assert.match(source, /const SAVE_FILE = join\(DATA_DIR, 'players\.json'\)/);
});
