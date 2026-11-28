import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLegacyDungeonSettlement } from '../src/dungeonLegacySettlementAdapter.js';

const requestId = 'request_123456';
const runId = `legacy_${requestId}`;
const binding = { dungeonId: 'dungeon_40', groupId: 'group_1', leaderId: 'p1', participantIds: ['p1', 'p2'] };

function player(input: {
  id: string;
  hpBefore: number;
  hpAfter: number;
  incoming: number;
  outgoing: number;
  xp: number;
  gold: number;
  loot: string[];
  result: 'win' | 'loss';
  binding?: { dungeonId: string; groupId: string; leaderId: string; participantIds: string[] };
}) {
  const report = {
    result: input.result,
    hpBefore: input.hpBefore,
    hpAfter: input.hpAfter,
    rewards: { xp: input.xp, gold: input.gold, loot: input.loot.join(',') },
  };
  const text = input.result === 'win' ? `Won: ${input.id}` : `Lost: ${input.id}`;
  const requestBinding = input.binding || binding;
  const quests = {
    dungeonRequestHistory: [{ id: requestId, report, text, binding: requestBinding }],
    dungeonLastRequest: { id: requestId, report, text, binding: requestBinding },
  };
  const eventId = `dungeon:${runId}:${input.id}:combatResult`;
  return {
    playerId: input.id,
    hpBefore: input.hpBefore,
    hpAfter: input.hpAfter,
    incomingDamage: input.incoming,
    outgoingDamage: input.outgoing,
    xp: input.xp,
    gold: input.gold,
    lootIds: [...input.loot],
    report,
    resultText: text,
    playerSnapshot: {
      id: input.id,
      health: input.hpAfter,
      gold: input.gold,
      inventory: JSON.stringify(input.loot),
      quests: JSON.stringify(quests),
    },
    outboxEvent: {
      eventId,
      runId,
      playerId: input.id,
      messageType: 'combatResult' as const,
      payload: { eventId, report, text, requestId },
    },
  };
}

function groupWinFixture() {
  const p1 = player({
    id: 'p1', hpBefore: 100, hpAfter: 96, incoming: 12, outgoing: 75.5,
    xp: 500, gold: 112, loot: ['dungeon_resource'], result: 'win',
  });
  const p2 = player({
    id: 'p2', hpBefore: 120, hpAfter: 109, incoming: 18, outgoing: 91.25,
    xp: 530, gold: 121, loot: ['rare_ore'], result: 'win',
  });
  return {
    runId, requestId, dungeonId: 'dungeon_40', bossId: 'boss_40',
    preparedAt: 1_800_000_000_000,
    participantIds: ['p1', 'p2'],
    combat: { rounds: 2, incoming: [12, 18], win: true, damageByParticipant: [75.5, 91.25] },
    drops: [
      { itemId: 'rare_ore', recipientId: 'p2' },
      { itemId: 'dungeon_resource', recipientId: 'p1' },
    ],
    players: [p1, p2],
  };
}

test('adapts a group victory without recalculating personalized rewards, healing, loot or outbox payloads', () => {
  const source = groupWinFixture();
  const prepared = prepareLegacyDungeonSettlement(source);

  assert.deepEqual(prepared.participantIds, ['p1', 'p2']);
  assert.deepEqual(prepared.combat, source.combat);
  assert.deepEqual(prepared.drops, source.drops);
  assert.equal(prepared.participants.p1.xp, 500);
  assert.equal(prepared.participants.p1.gold, 112);
  assert.equal(prepared.participants.p2.xp, 530);
  assert.equal(prepared.participants.p2.gold, 121);
  assert.equal(prepared.participants.p1.hpAfter, 96);
  assert.equal(prepared.participants.p2.hpAfter, 109);
  assert.deepEqual(prepared.outboxEvents, source.players.map(p => p.outboxEvent));
  assert.deepEqual(prepared.playerSnapshots.p1, source.players[0].playerSnapshot);
  assert.deepEqual(prepared.playerSnapshots.p2, source.players[1].playerSnapshot);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.outboxEvents?.[0].payload), true);
});

test('adapts a solo loss with clamped HP, no rewards and an exact replay/outbox result', () => {
  const p1 = player({
    id: 'p1', hpBefore: 7, hpAfter: 1, incoming: 12, outgoing: 15,
    xp: 0, gold: 0, loot: [], result: 'loss',
    binding: { dungeonId: 'dungeon_40', groupId: '', leaderId: 'p1', participantIds: ['p1'] },
  });
  const prepared = prepareLegacyDungeonSettlement({
    runId, requestId, dungeonId: 'dungeon_40', bossId: 'boss_40',
    preparedAt: 1_800_000_000_000,
    participantIds: ['p1'],
    combat: { rounds: 4, incoming: [12], win: false, damageByParticipant: [15] },
    drops: [],
    players: [p1],
  });

  assert.equal(prepared.combat.win, false);
  assert.equal(prepared.participants.p1.hpAfter, 1);
  assert.equal(prepared.participants.p1.xp, 0);
  assert.equal(prepared.participants.p1.gold, 0);
  assert.deepEqual(prepared.participants.p1.lootIds, []);
  assert.deepEqual(prepared.outboxEvents?.[0], p1.outboxEvent);
  assert.deepEqual(prepared.playerSnapshots.p1, p1.playerSnapshot);
});

test('rejects roster order drift and mismatched request/outbox payloads', () => {
  const wrongOrder = groupWinFixture();
  wrongOrder.players.reverse();
  assert.throws(() => prepareLegacyDungeonSettlement(wrongOrder), /ordered roster/);

  const wrongEvent = groupWinFixture();
  wrongEvent.players[0].outboxEvent.payload.requestId = 'another_request';
  assert.throws(() => prepareLegacyDungeonSettlement(wrongEvent), /payload is inconsistent/);
});

test('does not mutate the already-calculated legacy inputs', () => {
  const source = groupWinFixture();
  const before = JSON.parse(JSON.stringify(source));
  prepareLegacyDungeonSettlement(source);
  assert.deepEqual(source, before);
});
