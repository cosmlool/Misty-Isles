import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLegacyDungeonRequestReplay, type DungeonRequestBinding } from '../src/dungeonLegacyRequestReplay.js';
const binding: DungeonRequestBinding = { dungeonId: 'dungeon-1', groupId: 'group-1', leaderId: 'p1', participantIds: ['p1', 'p2'] };
const entry = (id: string, playerId: string, value = binding) => ({ id, report: { playerId }, text: 'saved', binding: value });
const participants = (first = entry('req_123', 'p1'), second = entry('req_123', 'p2')) => [
  { playerId: 'p1', entries: [first] }, { playerId: 'p2', entries: [second] },
];
test('replays only when every participant has the same fully bound saved result', () => {
  const result = resolveLegacyDungeonRequestReplay({ requestId: 'req_123', binding, participants: participants() });
  assert.equal(result.kind, 'replay');
  if (result.kind === 'replay') assert.deepEqual(result.entries.map(item => item.playerId), ['p1', 'p2']);
});
test('unknown request remains eligible for a fresh start', () => {
  assert.deepEqual(resolveLegacyDungeonRequestReplay({ requestId: 'req_123', binding, participants: [
    { playerId: 'p1', entries: [] }, { playerId: 'p2', entries: [] },
  ] }), { kind: 'not-found' });
});
test('rejects partial group cache instead of replaying only one member', () => {
  assert.deepEqual(resolveLegacyDungeonRequestReplay({ requestId: 'req_123', binding, participants: [
    { playerId: 'p1', entries: [entry('req_123', 'p1')] }, { playerId: 'p2', entries: [] },
  ] }), { kind: 'conflict', reason: 'partial' });
});
test('rejects reuse for another dungeon, group, leader or ordered roster', () => {
  for (const changed of [
    { ...binding, dungeonId: 'dungeon-2' }, { ...binding, groupId: 'group-2' },
    { ...binding, leaderId: 'p2' }, { ...binding, participantIds: ['p2', 'p1'] },
  ]) assert.deepEqual(resolveLegacyDungeonRequestReplay({ requestId: 'req_123', binding: changed, participants: participants() }),
    { kind: 'conflict', reason: 'identity' });
});
test('fails closed for pre-binding records and invalid participant order', () => {
  const legacy = { id: 'req_123', report: { result: 'win' }, text: 'saved' };
  assert.deepEqual(resolveLegacyDungeonRequestReplay({ requestId: 'req_123', binding, participants: [
    { playerId: 'p1', entries: [legacy] }, { playerId: 'p2', entries: [legacy] },
  ] }), { kind: 'conflict', reason: 'identity' });
  assert.deepEqual(resolveLegacyDungeonRequestReplay({ requestId: 'req_123', binding, participants: [
    { playerId: 'p2', entries: [] }, { playerId: 'p1', entries: [] },
  ] }), { kind: 'conflict', reason: 'invalid' });
});
