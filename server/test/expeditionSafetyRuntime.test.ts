import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, type Room } from 'colyseus.js';
import test from 'node:test';
import { utcIsoWeekKey } from '../src/calendarOperations.js';

import { seedGuestCredentials, testGuestProof, leaveRoomSafely } from './guestAuthTestHelpers.js';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticDataFiles = ['city_npcs.json', 'equipment_catalog.json', 'forgotten_lands.json'];

async function unusedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Isolated test server exited during startup.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/auth/check`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-real-token' }),
      });
      if (response.status === 401) return;
    } catch {}
    await delay(100);
  }
  throw new Error('Isolated test server did not become ready.');
}

async function guestToken(port: number, playerId: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/auth/guest`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, guestProof: testGuestProof(playerId) }),
  });
  assert.equal(response.status, 200);
  return (await response.json() as { token: string }).token;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(5_000)]);
  }
}

async function waitFor<T>(read: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await delay(25);
  }
  throw new Error(label + ' timed out.');
}

function readPlayers(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function publicCode(id: string): string {
  return createHash('sha256').update(`MistyIslesPublic:${id}`).digest('hex').slice(0, 24);
}

test('expedition reports capture pre/post health and disconnect cancels stale group participation', { timeout: 60_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-expedition-safety-'));
  const soloId = 'runtime_expedition_solo_01';
  const leaderId = 'runtime_expedition_leader_01';
  const memberId = 'runtime_expedition_member_01';
  const orphanId = 'runtime_expedition_orphan_01';
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  const rooms: Room[] = [];
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    const expeditionDataPath = join(dataDir, 'forgotten_lands.json');
    const expeditionData = JSON.parse(readFileSync(expeditionDataPath, 'utf8'));
    expeditionData.searchSeconds = 0;
    writeFileSync(expeditionDataPath, JSON.stringify(expeditionData, null, 2));
    const makePlayer = (id: string, name: string, friend: string, quests: any = {}) => ({
      id, name, race: 'Кот', level: 5, strength: 100_000, dexterity: 100_000,
      defense: 100, vitality: 100, stamina: 100, health: 1_000, maxHealth: 1_000,
      gold: 500, inventory: '[]', equipment: '{}',
      collections: JSON.stringify(friend ? { friends: friend.split(',') } : {}),
      quests: JSON.stringify(quests),
    });
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [soloId]: {
        ...makePlayer(soloId, 'Solo Explorer', leaderId, {
          expedition: { branchId: 'forgotten_lands', currentZoneId: 'el1', opened: 1, cleared: [], seen: {}, state: 'idle', startedAt: 0, endsAt: 0, groupId: '' },
        }),
        equipment: JSON.stringify({ amulet: 'PEN-001' }),
        collections: JSON.stringify({ friends: [leaderId], pendantLevels: { 'PEN-001': 1 } }),
        buff: 'xp', buffValue: 0.25, buffSecondaryEffect: 'gold', buffSecondaryValue: 0.10, buffUntil: Date.now() + 3_600_000,
      },
      [leaderId]: makePlayer(leaderId, 'Group Leader', `${memberId},${soloId},${orphanId}`),
      [memberId]: makePlayer(memberId, 'Group Member', leaderId),
      [orphanId]: makePlayer(orphanId, 'Orphaned Explorer', leaderId, {
        expedition: { branchId: 'forgotten_lands', currentZoneId: 'el1', opened: 1, cleared: [], seen: {}, state: 'searching', startedAt: Date.now() - 1_000, endsAt: Date.now() + 900_000, groupId: 'missing_group_after_restart' },
      }),
    }, null, 2));

    seedGuestCredentials(dataDir);


    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_GAME_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const serverOutput: string[] = [];
    child.stdout?.on('data', chunk => serverOutput.push(String(chunk)));
    child.stderr?.on('data', chunk => serverOutput.push(String(chunk)));
    await waitForServer(port, child);
    const client = new Client(`ws://127.0.0.1:${port}`);
    const ids = [soloId, leaderId, memberId, orphanId];
    const connected: Record<string, Room> = {};
    for (const id of ids) {
      const token = await guestToken(port, id);
      const room = await client.joinOrCreate('my_room', { playerId: id, sessionToken: token });
      connected[id] = room;
      rooms.push(room);
    }

    const orphanStates: any[] = [];
    connected[orphanId].onMessage('expeditionState', payload => orphanStates.push(payload));
    connected[orphanId].send('expeditionState');
    const orphanPayload = await waitFor(() => orphanStates[0], 'orphaned expedition state');
    const orphanState = orphanPayload.state;
    assert.equal(orphanState.state, 'idle', 'a search from a missing pre-restart group must not survive reconnect');
    assert.equal(orphanState.groupId, '');
    assert.equal(orphanState.endsAt, 0);

    const orphanNotices: string[] = [];
    connected[orphanId].onMessage('notice', payload => orphanNotices.push(String(payload?.text || '')));
    connected[orphanId].send('rename', { name: 'Orphaned Explorer' });
    await waitFor(() => orphanNotices.find(message => message.includes('Имя изменено')), 'orphan cleanup persistence');
    const persistedOrphan = JSON.parse(readPlayers(join(dataDir, 'players.json'))[orphanId].quests).expedition;
    assert.equal(persistedOrphan.state, 'idle');
    assert.equal(persistedOrphan.groupId, '');

    const dungeonLists: any[] = [];
    connected[soloId].onMessage('dungeonList', payload => dungeonLists.push(payload));
    connected[soloId].send('dungeonList', {});
    await delay(100);
    assert.equal(dungeonLists.length > 0, true, 'dungeon list must be returned');
    const currentDungeonIds = dungeonLists[dungeonLists.length - 1].dungeons.map((entry: any) => entry.id);
    assert.deepEqual(currentDungeonIds.sort(), ['fl_dungeon_03','fl_dungeon_06','fl_dungeon_09','fl_dungeon_10'].sort(), 'only Forgotten Lands dungeons may be listed');
    const beforeLegacyDungeon = readPlayers(join(dataDir, 'players.json'))[soloId];
    connected[soloId].send('dungeonRun', { id: 'root_vault', requestId: 'expedition_safety_dungeon_01' });
    await delay(100);
    const afterLegacyDungeon = readPlayers(join(dataDir, 'players.json'))[soloId];
    assert.equal(afterLegacyDungeon.gold, beforeLegacyDungeon.gold, 'legacy dungeon must not award gold');
    assert.equal(afterLegacyDungeon.experience, beforeLegacyDungeon.experience, 'legacy dungeon must not award XP');
    assert.equal(afterLegacyDungeon.battles, beforeLegacyDungeon.battles, 'legacy dungeon must not start a battle');
    assert.equal(afterLegacyDungeon.quests, beforeLegacyDungeon.quests, 'legacy dungeon must not consume a daily attempt');

    const soloNotices: string[] = [];
    connected[soloId].onMessage('notice', payload => soloNotices.push(String(payload?.text || '')));
    const combatResults: any[] = [];
    connected[soloId].onMessage('combatResult', payload => combatResults.push(payload));
    const initialExpeditionStates: any[] = [];
    connected[soloId].onMessage('expeditionState', payload => initialExpeditionStates.push(payload.state));
    connected[soloId].send('expeditionState');
    const initialExpeditionState = await waitFor(() => initialExpeditionStates[0], 'initial solo expedition state');
    assert.equal(initialExpeditionState.state, 'idle');

    connected[soloId].send('expeditionSearchStart');
    await waitFor(() => soloNotices.find(message => message.includes('Поиск монстра начался.')), 'solo expedition search start notice').catch(error => {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nNotices: ${soloNotices.join(' | ')}\nSaved state: ${JSON.stringify(JSON.parse(readPlayers(join(dataDir, 'players.json'))[soloId].quests).expedition)}`);
    });
    const startedSearch = JSON.parse(readPlayers(join(dataDir, 'players.json'))[soloId].quests).expedition;
    assert.equal(startedSearch.state, 'searching');
    assert.ok(Number(startedSearch.endsAt) <= Date.now(), 'zero-duration test search must be immediately claimable');
    connected[soloId].send('expeditionSearchClaim');
    const combat = await waitFor(() => combatResults[0], 'solo expedition combat report').catch(error => {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nNotices: ${soloNotices.join(' | ')}\nServer output:\n${serverOutput.slice(-80).join('')}`);
    });
    assert.equal(combat.report.result, 'win');
    assert.equal(combat.report.hpBefore, 1_000);
    assert.ok(combat.report.hpAfter < combat.report.hpBefore, 'combat report must show actual health loss');
    const rewardedMonster = expeditionData.monsters.find((entry: any) => entry.name === combat.report.enemy);
    assert.ok(rewardedMonster, 'the reported expedition monster must exist in the test catalogue');
    assert.equal(combat.report.rewards.xp, Math.floor(rewardedMonster.xp * 1.005 * 1.25), 'expedition report must include the XP pendant and active XP buff');
    assert.equal(combat.report.rewards.gold, Math.floor(rewardedMonster.gold * 1.10), 'expedition report must include the active gold buff');
    assert.ok(combat.text.includes(`${combat.report.rewards.xp} опыта`) && combat.text.includes(`${combat.report.rewards.gold} золота`), 'expedition result text must match actual modified rewards');
    const soloProgress = JSON.parse(readPlayers(join(dataDir, 'players.json'))[soloId].quests);
    assert.equal(soloProgress.dailyHunts, 1, 'an expedition victory must count toward the daily monster-win challenge');
    assert.equal(soloProgress.weeklyHunts, 1, 'an expedition victory must count toward the weekly monster-win challenge');
    assert.equal(soloProgress.challengeWeek, utcIsoWeekKey());

    const afterHuntSave = readPlayers(join(dataDir, 'players.json'))[soloId];
    assert.ok(Number(afterHuntSave.lastHuntAt) > 0, 'a completed expedition hunt must update lastHuntAt');
    assert.equal(new Date(afterHuntSave.lastHuntAt).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
    const goldBeforeDailyHunt = Number(afterHuntSave.gold);
    connected[soloId].send('quest', { id: 'daily_hunt' });
    await waitFor(() => soloNotices.find(message => message.includes('Ежедневная охота') && message.includes('+300 золота')), 'daily hunt reward after expedition');
    const afterDailyHunt = readPlayers(join(dataDir, 'players.json'))[soloId];
    assert.equal(afterDailyHunt.gold, goldBeforeDailyHunt + 300, 'daily hunt must award its configured gold exactly once');
    connected[soloId].send('quest', { id: 'daily_hunt' });
    await waitFor(() => soloNotices.find(message => message.includes('Награда за это задание уже получена.')), 'duplicate daily hunt claim');
    assert.equal(readPlayers(join(dataDir, 'players.json'))[soloId].gold, goldBeforeDailyHunt + 300, 'daily hunt reward must not be duplicated');

    const previousSearchStartedAt = Number(readPlayers(join(dataDir, 'players.json'))[soloId].quests
      ? JSON.parse(readPlayers(join(dataDir, 'players.json'))[soloId].quests).expedition?.startedAt || 0
      : 0);
    connected[soloId].send('expeditionSearchStart');
    const soloSearchBeforeReload = await waitFor(() => {
      const state = JSON.parse(readPlayers(join(dataDir, 'players.json'))[soloId].quests).expedition;
      return state?.state === 'searching' && Number(state.startedAt) > previousSearchStartedAt ? state : undefined;
    }, 'new solo search persisted before page reload');
    await waitFor(() => soloNotices.some(message => message.includes('Поиск монстра начался.')),
      'solo search before page reload notice');
    assert.equal(soloSearchBeforeReload.state, 'searching');
    const soloSearchEndsAt = Number(soloSearchBeforeReload.endsAt);
    await connected[soloId].leave();
    const soloSearchAfterDisconnect = await waitFor(() => {
      const state = JSON.parse(readPlayers(join(dataDir, 'players.json'))[soloId].quests).expedition;
      return state?.state === 'searching' && Number(state.endsAt) === soloSearchEndsAt ? state : undefined;
    }, 'solo expedition search persistence after disconnect');
    assert.equal(soloSearchAfterDisconnect.endsAt, soloSearchEndsAt,
      'disconnecting a solo client must not reset the active search timer');

    const soloReconnectToken = await guestToken(port, soloId);
    connected[soloId] = await client.joinOrCreate('my_room', { playerId: soloId, sessionToken: soloReconnectToken });
    rooms.push(connected[soloId]);
    const restoredSoloStates: any[] = [];
    connected[soloId].onMessage('expeditionState', payload => restoredSoloStates.push(payload.state));
    connected[soloId].send('expeditionState');
    const restoredSoloSearch = await waitFor(() => restoredSoloStates[0], 'solo expedition state after page reload');
    assert.equal(restoredSoloSearch.state, 'searching',
      'reconnecting after a page reload must restore the active solo search');
    assert.equal(restoredSoloSearch.endsAt, soloSearchEndsAt,
      'reconnecting must preserve the original search completion timestamp');

    const invitations: any[] = [];
    connected[memberId].onMessage('huntGroupInvite', payload => invitations.push(payload));
    connected[leaderId].send('huntGroupInvite', { targetId: publicCode(memberId) });
    const invite = await waitFor(() => invitations[0], 'group invitation');
    const groupStates: any[] = [];
    connected[leaderId].onMessage('huntGroupState', payload => groupStates.push(payload));
    connected[memberId].send('huntGroupAccept', { groupId: invite.groupId });
    await waitFor(() => groupStates.find(payload => payload.group?.members?.length === 2), 'two-member group acceptance');
    await waitFor(() => {
      const players = readPlayers(join(dataDir, 'players.json'));
      const q = JSON.parse(players[leaderId].quests);
      return q.expedition ? true : undefined;
    }, 'group setup');
    const pendingInvites: any[] = [];
    connected[soloId].onMessage('huntGroupInvite', payload => pendingInvites.push(payload));
    connected[leaderId].send('huntGroupInvite', { targetId: publicCode(soloId) });
    const pendingInvite = await waitFor(() => pendingInvites[0], 'pending invite before expedition');

    connected[leaderId].send('expeditionSearchStart');
    await waitFor(() => {
      const players = readPlayers(join(dataDir, 'players.json'));
      const leader = JSON.parse(players[leaderId].quests).expedition;
      const member = JSON.parse(players[memberId].quests).expedition;
      return leader?.state === 'searching' && member?.state === 'searching' ? true : undefined;
    }, 'shared expedition search');

    const lateJoinNotices: string[] = [];
    connected[soloId].onMessage('notice', payload => lateJoinNotices.push(String(payload?.text || '')));
    connected[soloId].send('huntGroupAccept', { groupId: pendingInvite.groupId });
    await waitFor(() => lateJoinNotices.find(message => message.includes('Нельзя вступить в группу во время поиска')), 'late group acceptance lock');

    const activeInviteNotices: string[] = [];
    connected[leaderId].onMessage('notice', payload => activeInviteNotices.push(String(payload?.text || '')));
    const lateInvites: any[] = [];
    connected[orphanId].onMessage('huntGroupInvite', payload => lateInvites.push(payload));
    connected[leaderId].send('huntGroupInvite', { targetId: publicCode(orphanId) });
    await waitFor(() => activeInviteNotices.find(message => message.includes('Нельзя менять состав группы во время поиска')), 'active group invitation lock');
    assert.equal(lateInvites.length, 0, 'an active expedition must not accept new group invitations');

    const groupResults: Record<string, any[]> = { [leaderId]: [], [memberId]: [] };
    const groupHistories: Record<string, any[]> = { [leaderId]: [], [memberId]: [] };
    for (const id of [leaderId, memberId]) {
      connected[id].onMessage('combatResult', payload => groupResults[id].push(payload));
      connected[id].onMessage('combatHistory', payload => groupHistories[id].push(payload));
    }
    connected[leaderId].send('expeditionSearchClaim');
    const leaderResult = await waitFor(() => groupResults[leaderId][0], 'group expedition leader result');
    const memberResult = await waitFor(() => groupResults[memberId][0], 'group expedition member result');
    assert.equal(leaderResult.report.result, 'win');
    assert.equal(memberResult.report.result, 'win');
    const afterGroupFight = readPlayers(join(dataDir, 'players.json'));
    for (const [id, result] of [[leaderId, leaderResult], [memberId, memberResult]] as const) {
      const player = afterGroupFight[id];
      const quests = JSON.parse(player.quests);
      assert.equal(result.report.hpBefore, 1_000);
      assert.equal(result.report.hpAfter, player.health);
      assert.equal(player.battles, 1, 'every group expedition participant must count the battle');
      assert.equal(player.mobsKilled, 1);
      assert.equal(player.victories, 1);
      assert.equal(quests.activityToday.hunts, 1);
      assert.equal(quests.activityToday.wins, 1);
      assert.ok(groupHistories[id].some(payload => payload.history?.[0]?.result === 'win'));
    }

    connected[leaderId].send('expeditionSearchStart');
    await waitFor(() => {
      const players = readPlayers(join(dataDir, 'players.json'));
      const leader = JSON.parse(players[leaderId].quests).expedition;
      const member = JSON.parse(players[memberId].quests).expedition;
      return leader?.state === 'searching' && member?.state === 'searching' ? true : undefined;
    }, 'second shared expedition search before disconnect');

    await connected[memberId].leave();
    const savedAfterLeave = await waitFor(() => {
      const player = readPlayers(join(dataDir, 'players.json'))[memberId];
      const state = JSON.parse(player.quests).expedition;
      return state?.state === 'idle' && state?.groupId === '' && state?.endsAt === 0 ? state : undefined;
    }, 'disconnected member expedition cancellation');
    const savedLeaderAfterLeave = readPlayers(join(dataDir, 'players.json'))[leaderId];
    const leaderExpeditionAfterLeave = JSON.parse(savedLeaderAfterLeave.quests).expedition;
    assert.equal(leaderExpeditionAfterLeave.state, 'idle',
      'disconnecting one participant must cancel the active group search for every remaining participant');
    assert.equal(leaderExpeditionAfterLeave.groupId, JSON.parse(readFileSync(join(dataDir, 'hunt_groups.json'), 'utf8'))[0].id,
      'the remaining online leader must retain the persisted group association');
    assert.equal(leaderExpeditionAfterLeave.endsAt, 0);


    const token = await guestToken(port, memberId);
    connected[memberId] = await client.joinOrCreate('my_room', { playerId: memberId, sessionToken: token });
    rooms.push(connected[memberId]);
    assert.equal(savedAfterLeave.state, 'idle');
    assert.equal(JSON.parse(readPlayers(join(dataDir, 'players.json'))[memberId].quests).expedition.state, 'idle');
    const beforeLegacyHunt = readPlayers(join(dataDir, 'players.json'))[soloId];
    const legacyHuntReports: any[] = [];
    connected[soloId].onMessage('combatResult', payload => legacyHuntReports.push(payload));
    connected[soloId].send('hunt', { zone: 'mistwood' });
    await delay(250);
    const afterLegacyHunt = readPlayers(join(dataDir, 'players.json'))[soloId];
    assert.equal(afterLegacyHunt.gold, beforeLegacyHunt.gold, 'legacy TOWNS hunt must not award gold');
    assert.equal(afterLegacyHunt.experience, beforeLegacyHunt.experience, 'legacy TOWNS hunt must not award XP');
    assert.equal(afterLegacyHunt.battles, beforeLegacyHunt.battles, 'legacy TOWNS hunt must not count a battle');
    assert.equal(legacyHuntReports.length, 0, 'legacy TOWNS hunt must not start combat');

  } finally {
    for (const room of rooms) await leaveRoomSafely(room);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
