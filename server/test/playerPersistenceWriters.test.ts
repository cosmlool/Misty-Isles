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
