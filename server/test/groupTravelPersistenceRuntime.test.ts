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

import { seedGuestCredentials, testGuestProof, leaveRoomSafely } from './guestAuthTestHelpers.js';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticDataFiles = ['city_npcs.json', 'equipment_catalog.json'];

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

test('group expedition travel start and claim persist every member together', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-group-travel-'));
  const leaderId = 'runtime_group_travel_leader';
  const memberId = 'runtime_group_travel_member';
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  const rooms: Room[] = [];
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    const expeditionData = JSON.parse(readFileSync(join(serverDir, 'data', 'forgotten_lands.json'), 'utf8'));
    expeditionData.travelSeconds = 0;
    expeditionData.searchSeconds = 0;
    writeFileSync(join(dataDir, 'forgotten_lands.json'), JSON.stringify(expeditionData, null, 2));
    const makePlayer = (id: string, name: string, friend: string) => ({
      id, name, race: id === leaderId ? 'Грызун' : 'Кот', profession: id === leaderId ? 'Вампир' : '',
      level: id === leaderId ? 20 : 3, gold: id === leaderId ? 5_000 : 500,
      health: id === leaderId ? 50 : 100, maxHealth: 100,
      buff: id === memberId ? 'xp' : '', buffValue: id === memberId ? 0.12 : 0,
      buffSecondaryEffect: id === memberId ? 'gold' : '',
      buffSecondaryValue: id === memberId ? 0.15 : 0, buffUntil: id === memberId ? Date.now() + 60 * 60 * 1000 : 0,
      inventory: '[]', equipment: '{}',
      collections: JSON.stringify({ friends: [friend] }),
      quests: JSON.stringify({
        expedition: { branchId: 'forgotten_lands', currentZoneId: 'el1', opened: 2, cleared: [], seen: {}, state: 'idle', endsAt: 0, groupId: '' },
      }),
    });
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [leaderId]: makePlayer(leaderId, 'Travel Leader', memberId),
      [memberId]: makePlayer(memberId, 'Travel Member', leaderId),
    }, null, 2));

    seedGuestCredentials(dataDir);


    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    const client = new Client(`ws://127.0.0.1:${port}`);
    const connected: Record<string, Room> = {};
    for (const id of [leaderId, memberId]) {
      const token = await guestToken(port, id);
      connected[id] = await client.joinOrCreate('my_room', { playerId: id, sessionToken: token });
      rooms.push(connected[id]);
    }

    const invitations: any[] = [];
    const groupStates: any[] = [];
    const leaderNotices: string[] = [];
    const leaderCombatResults: any[] = [];
    const memberCombatResults: any[] = [];
    connected[memberId].onMessage('huntGroupInvite', payload => invitations.push(payload));
    connected[leaderId].onMessage('huntGroupState', payload => groupStates.push(payload));
    connected[leaderId].onMessage('notice', payload => leaderNotices.push(String(payload?.text || '')));
    connected[leaderId].onMessage('combatResult', payload => leaderCombatResults.push(payload));
    connected[memberId].onMessage('combatResult', payload => memberCombatResults.push(payload));
    connected[leaderId].send('professionSkill', { id: 'blood_burst' });
    await waitFor(() => leaderNotices.find(message => message.includes('Навык «Кровавый всплеск» изучен')), 'learn compound vampire skill');
    connected[leaderId].send('professionSkill', { id: 'blood_burst' });
    await waitFor(() => leaderNotices.find(message => message.includes('Применён навык «Кровавый всплеск»')), 'apply compound vampire skill');
    connected[leaderId].send('huntGroupInvite', { targetId: publicCode(memberId) });
    const invite = await waitFor(() => invitations[0], 'group invitation');
    connected[memberId].send('huntGroupAccept', { groupId: invite.groupId });
    await waitFor(() => groupStates.find(payload => payload.group?.members?.length === 2), 'two-member group acceptance');

    connected[leaderId].send('expeditionTravelStart', { zoneId: 'el2' });
    await waitFor(() => {
      const players = readPlayers(join(dataDir, 'players.json'));
      const leader = JSON.parse(players[leaderId].quests).expedition;
      const member = JSON.parse(players[memberId].quests).expedition;
      return leader?.state === 'moving' && member?.state === 'moving' &&
        leader.targetZoneId === 'el2' && member.targetZoneId === 'el2' ? true : undefined;
    }, 'both travel-start states persisted');

    connected[leaderId].send('huntGroupLeave');
    await waitFor(() => leaderNotices.find(message => message === 'Нельзя покидать группу во время поиска или перехода.'), 'block group leave during travel');
    assert.equal(groupStates[groupStates.length - 1]?.group?.members?.length, 2);
    const afterBlockedTravelLeave = readPlayers(join(dataDir, 'players.json'));
    assert.equal(JSON.parse(afterBlockedTravelLeave[leaderId].quests).expedition.state, 'moving');
    assert.equal(JSON.parse(afterBlockedTravelLeave[memberId].quests).expedition.state, 'moving');

    connected[leaderId].send('expeditionTravelClaim');
    await waitFor(() => {
      const players = readPlayers(join(dataDir, 'players.json'));
      const leader = JSON.parse(players[leaderId].quests).expedition;
      const member = JSON.parse(players[memberId].quests).expedition;
      return leader?.state === 'idle' && member?.state === 'idle' &&
        leader.currentZoneId === 'el2' && member.currentZoneId === 'el2' ? true : undefined;
    }, 'both travel-claim states persisted');

    connected[leaderId].send('expeditionSearchStart');
    await waitFor(() => {
      const players = readPlayers(join(dataDir, 'players.json'));
      const leader = JSON.parse(players[leaderId].quests).expedition;
      const member = JSON.parse(players[memberId].quests).expedition;
      return leader?.state === 'searching' && member?.state === 'searching' ? true : undefined;
    }, 'both group search states persisted');
    connected[leaderId].send('huntGroupLeave');
    await waitFor(() => leaderNotices.filter(message => message === 'Нельзя покидать группу во время поиска или перехода.').length > 1 ? true : undefined, 'block group leave during search');
    assert.equal(groupStates[groupStates.length - 1]?.group?.members?.length, 2);
    const afterBlockedSearchLeave = readPlayers(join(dataDir, 'players.json'));
    assert.equal(JSON.parse(afterBlockedSearchLeave[leaderId].quests).expedition.state, 'searching');
    assert.equal(JSON.parse(afterBlockedSearchLeave[memberId].quests).expedition.state, 'searching');

    connected[leaderId].send('expeditionSearchClaim');
    const leaderCombat = await waitFor(() => leaderCombatResults[0], 'leader expedition combat result');
    const memberCombat = await waitFor(() => memberCombatResults[0], 'member expedition combat result');
    assert.equal(leaderCombat.report.result, 'win');
    assert.equal(memberCombat.report.result, 'win');
    const saved = readPlayers(join(dataDir, 'players.json'));
    const baseXp = Number(leaderCombat.report.rewards.xp);
    assert.equal(saved[leaderId].experience, baseXp, 'leader without an XP buff must receive base expedition experience');
    assert.equal(saved[memberId].experience, Math.floor(baseXp * 1.12), 'XP buff must increase expedition experience');
    assert.equal(saved[leaderId].buffSecondaryEffect, 'lifesteal', 'profession skill must persist its secondary effect');
    const baseGold = Number(memberCombat.report.rewards.gold);
    assert.equal(saved[memberId].gold, 500 + baseGold, 'expedition combat report must expose the actual gold amount after the secondary gold buff');
    assert.ok(leaderCombat.report.hpAfter > Math.max(1, leaderCombat.report.hpBefore - leaderCombat.report.received), 'secondary lifesteal buff must heal after a successful fight');
    for (const id of [leaderId, memberId]) {
      const state = JSON.parse(saved[id].quests).expedition;
      assert.equal(state.currentZoneId, 'el2');
      assert.equal(state.state, 'idle');
      assert.equal(state.endsAt, 0);
      assert.equal(state.targetZoneId, undefined);
    }

    const savedGroups = JSON.parse(readFileSync(join(dataDir, 'hunt_groups.json'), 'utf8'));
    assert.equal(savedGroups.length, 1, 'accepted group must be persisted');
    assert.deepEqual(savedGroups[0].members, [leaderId, memberId]);

    for (const room of rooms) await leaveRoomSafely(room);
    rooms.length = 0;
    await stopServer(child!);
    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);

    const restartedClient = new Client(`ws://127.0.0.1:${port}`);
    const leaderRoom = await restartedClient.joinOrCreate('my_room', {
      playerId: leaderId, sessionToken: await guestToken(port, leaderId),
    });
    rooms.push(leaderRoom);
    const leaderGroupStates: any[] = [];
    leaderRoom.onMessage('huntGroupState', payload => leaderGroupStates.push(payload));
    leaderRoom.send('huntGroupList');
    const restoredWithOfflineMember = await waitFor(
      () => leaderGroupStates.find(payload => payload.group?.members?.length === 2),
      'restored group with offline member',
    );
    assert.equal(restoredWithOfflineMember.group.members.find((member: any) => member.id === publicCode(memberId))?.online, false,
      'an offline member must retain their group slot after restart');

    const memberRoom = await restartedClient.joinOrCreate('my_room', {
      playerId: memberId, sessionToken: await guestToken(port, memberId),
    });
    rooms.push(memberRoom);
    const memberGroupStates: any[] = [];
    memberRoom.onMessage('huntGroupState', payload => memberGroupStates.push(payload));
    memberRoom.send('huntGroupList');
    const restoredWithBothOnline = await waitFor(
      () => memberGroupStates.find(payload => payload.group?.members?.length === 2 &&
        payload.group.members.every((member: any) => member.online)),
      'restored group after both members reconnect',
    );
    assert.equal(restoredWithBothOnline.group.leader, publicCode(leaderId));

    leaderRoom.send('expeditionTravelStart', { zoneId: 'el2' });
    await waitFor(() => {
      const players = readPlayers(join(dataDir, 'players.json'));
      return JSON.parse(players[leaderId].quests).expedition.state === 'moving' &&
        JSON.parse(players[memberId].quests).expedition.state === 'moving' ? true : undefined;
    }, 'restored group starts a persisted travel action');

    await memberRoom.leave();
    await waitFor(() => {
      const players = readPlayers(join(dataDir, 'players.json'));
      const leaderState = JSON.parse(players[leaderId].quests).expedition;
      const memberState = JSON.parse(players[memberId].quests).expedition;
      return leaderState.state === 'idle' && memberState.state === 'idle' &&
        leaderState.endsAt === 0 && memberState.endsAt === 0 ? true : undefined;
    }, 'disconnect during group travel cancels movement for all members');
    const rosterAfterTravelDisconnect = JSON.parse(readFileSync(join(dataDir, 'hunt_groups.json'), 'utf8'));
    assert.equal(rosterAfterTravelDisconnect.length, 1, 'disconnect must not remove the offline member from the group');
    assert.deepEqual(rosterAfterTravelDisconnect[0].members, [leaderId, memberId]);

    const reconnectedMemberRoom = await restartedClient.joinOrCreate('my_room', {
      playerId: memberId, sessionToken: await guestToken(port, memberId),
    });
    rooms.push(reconnectedMemberRoom);
    memberRoom = reconnectedMemberRoom;


    const memberNotices: string[] = [];
    const restoredLeaderNotices: string[] = [];
    memberRoom.onMessage('notice', payload => memberNotices.push(String(payload?.text || '')));
    leaderRoom.onMessage('notice', payload => restoredLeaderNotices.push(String(payload?.text || '')));

    leaderRoom.send('huntGroupLeave');
    await waitFor(() => restoredLeaderNotices.find(message => message === 'Ты покинул охотничью группу.'), 'leader leaves and transfers leadership');
    const afterLeaderLeave = JSON.parse(readFileSync(join(dataDir, 'hunt_groups.json'), 'utf8'));
    assert.equal(afterLeaderLeave.length, 1);
    assert.equal(afterLeaderLeave[0].leader, memberId, 'remaining member must become the new leader');
    assert.deepEqual(afterLeaderLeave[0].members, [memberId]);
    const afterLeaderPlayerSave = readPlayers(join(dataDir, 'players.json'));
    assert.equal(JSON.parse(afterLeaderPlayerSave[leaderId].quests).expedition.groupId, '',
      'departing leader expedition membership must be cleared in the same persisted snapshot');

    memberRoom.send('huntGroupLeave');
    await waitFor(() => memberNotices.find(message => message === 'Ты покинул охотничью группу.'), 'last member leaves and disbands group');
    const afterDisband = JSON.parse(readFileSync(join(dataDir, 'hunt_groups.json'), 'utf8'));
    assert.deepEqual(afterDisband, [], 'last explicit leave must persist an empty group roster');
    const afterMemberSave = readPlayers(join(dataDir, 'players.json'));
    assert.equal(JSON.parse(afterMemberSave[memberId].quests).expedition.groupId, '',
      'departing member expedition membership must be cleared');
  } finally {
    for (const room of rooms) await leaveRoomSafely(room);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
