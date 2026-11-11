import assert from 'node:assert/strict';
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
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, guestProof: testGuestProof(playerId) }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as { token: string };
  return payload.token;
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

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function waitFor<T>(read: () => T | undefined, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await delay(25);
  }
  throw new Error(label + ' timed out.');
}

test('clan war attacks enforce per-player cooldown and accumulate real damage', { timeout: 60_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-clan-war-runtime-'));
  const playerA = 'runtime_war_player_a';
  const playerB = 'runtime_war_player_b';
  const playerC = 'runtime_war_nonmember';
  const yesterday = Math.floor(Date.now() / (24 * 60 * 60 * 1000)) - 1;
  const today = yesterday + 1;
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let roomA: Room | undefined;
  let roomB: Room | undefined;
  let roomC: Room | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [playerA]: {
        id: playerA, name: 'War Attacker A', race: 'Кот', level: 25, strength: 40, defense: 20,
        gold: 250, buff: 'attack', buffValue: 0.15, buffUntil: Date.now() + 5 * 60 * 1000,
        clan: 'clan-a', inventory: '[]', equipment: '{}', quests: '{}',
      },
      [playerB]: {
        id: playerB, name: 'War Attacker B', race: 'Собака', level: 25, strength: 35, defense: 20,
        gold: 250, clan: 'clan-b', inventory: '[]', equipment: '{}', quests: '{}',
      },
      [playerC]: {
        id: playerC, name: 'Clan Nonmember', race: 'Кот', level: 25, strength: 40, defense: 20,
        gold: 500, goldSpent: 0, crystals: 0, clan: 'clan-a', inventory: '[]', equipment: '{}', quests: '{}',
      },
    }, null, 2));
    writeFileSync(join(dataDir, 'clans.json'), JSON.stringify({
      'clan-a': { id: 'clan-a', name: 'Клан А', leader: playerA, level: 2, vault: 0, seasonPoints: 0, members: [{ id: playerA, name: 'War Attacker A' }], upgrades: { barracks: 0 }, questDay: yesterday, questProgress: { donate: 1900, raid: 2, war: 3, territory: 1 } },
      'clan-b': { id: 'clan-b', name: 'Клан Б', level: 2, vault: 0, seasonPoints: 0, members: [{ id: playerB, name: 'War Attacker B' }], upgrades: { barracks: 0 } },
    }, null, 2));
    writeFileSync(join(dataDir, 'clan_wars.json'), JSON.stringify([{
      id: 'war-runtime', a: 'clan-a', b: 'clan-b', aName: 'Клан А', bName: 'Клан Б',
      aDamage: 0, bDamage: 0, lastAttackAtByPlayer: {}, status: 'active',
      createdAt: Date.now(), endsAt: Date.now() + 60_000,
    }], null, 2));
    writeFileSync(join(dataDir, 'clan_territories.json'), JSON.stringify([
      { id: 'territory-runtime', owner: 'clan-a', ownerName: 'Клан А', capturedAt: 1, defense: 10 },
    ], null, 2));

    seedGuestCredentials(dataDir);


    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    const client = new Client(`ws://127.0.0.1:${port}`);
    const [tokenA, tokenB, tokenC] = await Promise.all([guestToken(port, playerA), guestToken(port, playerB), guestToken(port, playerC)]);
    [roomA, roomB, roomC] = await Promise.all([
      client.joinOrCreate('my_room', { playerId: playerA, sessionToken: tokenA }),
      client.joinOrCreate('my_room', { playerId: playerB, sessionToken: tokenB }),
      client.joinOrCreate('my_room', { playerId: playerC, sessionToken: tokenC }),
    ]);

    const noticesA: string[] = [];
    const noticesB: string[] = [];
    const noticesC: string[] = [];
    const warListsA: any[] = [];
    const warListsB: any[] = [];
    const clanListsA: any[] = [];
    const clanListsB: any[] = [];
    roomA.onMessage('notice', payload => noticesA.push(String(payload?.text || '')));
    roomB.onMessage('notice', payload => noticesB.push(String(payload?.text || '')));
    roomC.onMessage('notice', payload => noticesC.push(String(payload?.text || '')));
    roomA.onMessage('clanWarList', payload => warListsA.push(payload));
    roomB.onMessage('clanWarList', payload => warListsB.push(payload));
    roomA.onMessage('clanList', payload => clanListsA.push(payload));
    roomB.onMessage('clanList', payload => clanListsB.push(payload));

    const unauthorizedClanActions: Array<[string, any]> = [
      ['clanDonate', { amount: 100 }],
      ['clanRaid', {}],
      ['clanSeasonReward', {}],
      ['clanTerritoryCapture', { id: 'territory-runtime' }],
      ['clanQuestClaim', { id: 'donate' }],
      ['clanUpgrade', { upgrade: 'barracks' }],
      ['clanWarChallenge', { clanId: 'clan-b' }],
      ['clanWarAttack', { id: 'war-runtime' }],
    ];
    for (const [action, payload] of unauthorizedClanActions) {
      const before = noticesC.length;
      roomC.send(action, payload);
      await waitFor(() => noticesC.slice(before).find(text => text === 'Персонаж не состоит в этом клане.'), `nonmember rejection for ${action}`);
    }
    const nonmemberPlayers = readJson(join(dataDir, 'players.json'));
    const nonmemberClans = readJson(join(dataDir, 'clans.json'));
    assert.equal(nonmemberPlayers[playerC].gold, 500);
    assert.equal(nonmemberPlayers[playerC].goldSpent, 0);
    assert.equal(nonmemberPlayers[playerC].crystals, 0);
    assert.equal(nonmemberClans['clan-a'].vault, 0);
    assert.equal(nonmemberClans['clan-a'].seasonPoints, 0);
    assert.equal(nonmemberClans['clan-a'].lastRaidAt, undefined);
    assert.equal(nonmemberClans['clan-a'].lastTerritoryCaptureAt, undefined);
    assert.equal(nonmemberClans['clan-a'].lastSeasonRewardWeek, undefined);
    assert.equal(readJson(join(dataDir, 'clan_wars.json')).length, 1);

    roomA.send('clanDonate', { amount: 100 });
    await waitFor(() => noticesA.find(text => text.startsWith('Вклад в клан: 100')), 'atomic clan donation');
    const afterDonationPlayers = readJson(join(dataDir, 'players.json'));
    const afterDonationClans = readJson(join(dataDir, 'clans.json'));
    assert.equal(afterDonationPlayers[playerA].gold, 150);
    assert.equal(afterDonationPlayers[playerA].goldSpent, 100);
    assert.equal(afterDonationClans['clan-a'].vault, 100);
    assert.equal(afterDonationClans['clan-a'].questDay, today);
    assert.equal(afterDonationClans['clan-a'].questProgress.donate, 100, 'first donation after daily reset must count');
    assert.equal(afterDonationClans['clan-a'].questProgress.raid, 0);

    roomA.send('clanWarAttack', { id: 'war-runtime' });
    await waitFor(() => noticesA.find(text => text.startsWith('Атака нанесла')), 'first clan A attack');
    const afterFirst = readJson(join(dataDir, 'clan_wars.json'))[0];
    assert.ok(afterFirst.aDamage > 30, 'active attack buff must increase clan-war damage beyond the unbuffed range');
    assert.equal(afterFirst.bDamage, 0);
    await waitFor(() => warListsB.find(payload => payload.wars?.some((war:any) => war.id === 'war-runtime' && war.aDamage === afterFirst.aDamage)), 'live score broadcast to opposing clan');

    roomA.send('clanWarAttack', { id: 'war-runtime' });
    await waitFor(() => noticesA.find(text => text.startsWith('Следующая атака через')), 'clan A cooldown response');
    assert.equal(readJson(join(dataDir, 'clan_wars.json'))[0].aDamage, afterFirst.aDamage);

    roomB.send('clanWarAttack', { id: 'war-runtime' });
    await waitFor(() => noticesB.find(text => text.startsWith('Атака нанесла')), 'first clan B attack');
    const afterB = readJson(join(dataDir, 'clan_wars.json'))[0];
    assert.ok(afterB.bDamage > 0, 'the opposing clan can attack during player A cooldown');

    await delay(1_050);
    roomA.send('clanWarAttack', { id: 'war-runtime' });
    const afterSecond = await waitFor(() => {
      const current = readJson(join(dataDir, 'clan_wars.json'))[0];
      return current.aDamage > afterFirst.aDamage ? current : undefined;
    }, 'second clan A attack damage persistence');
    assert.ok(afterSecond.aDamage > afterFirst.aDamage, 'second attack adds to the cumulative clan damage');
    assert.ok(afterSecond.bDamage > 0);
    assert.equal(afterSecond.lastAttackAtByPlayer[playerA] > afterFirst.lastAttackAtByPlayer[playerA], true);

    // Finish the war and ensure both teams receive the final clan treasury and season standings.
    writeFileSync(join(dataDir, 'clan_wars.json'), JSON.stringify([{
      ...afterSecond, aDamage: 1_000, bDamage: 1, endsAt: Date.now() - 1,
    }], null, 2));
    const staleClanQuest = readJson(join(dataDir, 'clans.json'));
    staleClanQuest['clan-a'].questDay = yesterday;
    staleClanQuest['clan-a'].questProgress = { donate: 900, raid: 1, war: 2, territory: 1 };
    writeFileSync(join(dataDir, 'clans.json'), JSON.stringify(staleClanQuest, null, 2));
    roomA.send('clanWarList');
    await waitFor(() => clanListsB.find(payload => payload.clans?.some((clan:any) =>
      clan.id === 'clan-a' && clan.vault === 300 && clan.seasonPoints === 20)),
    'final clan reward broadcast to opposing team');
    await waitFor(() => warListsB.find(payload => !payload.wars?.some((war:any) => war.id === 'war-runtime')),
      'finished war broadcast to opposing team');
    const finished = readJson(join(dataDir, 'clan_wars.json'))[0];
    const savedClans = readJson(join(dataDir, 'clans.json'));
    assert.equal(finished.status, 'finished');
    assert.equal(finished.winnerId, 'clan-a');
    assert.equal(finished.reward, 200);
    assert.equal(savedClans['clan-a'].vault, 300);
    assert.equal(savedClans['clan-a'].seasonPoints, 20);
    assert.equal(savedClans['clan-a'].questDay, today);
    assert.equal(savedClans['clan-a'].questProgress.war, 1, 'war reward after daily reset must count');
    assert.equal(savedClans['clan-a'].questProgress.donate, 0);

    roomB.send('clanWarList');
    await delay(100);
    const clansAfterRefresh = readJson(join(dataDir, 'clans.json'));
    assert.equal(clansAfterRefresh['clan-a'].vault, 300, 'refresh must not pay the war reward twice');

    // An expired-but-unsettled war must not block a new challenge.
    const staleWars = readJson(join(dataDir, 'clan_wars.json'));
    staleWars.push({
      id: 'war-expired-stale', a: 'clan-a', b: 'clan-b', aName: 'Клан А', bName: 'Клан Б',
      aDamage: 0, bDamage: 0, lastAttackAtByPlayer: {}, status: 'active',
      createdAt: Date.now() - 90_000_000, endsAt: Date.now() - 1,
    });
    writeFileSync(join(dataDir, 'clan_wars.json'), JSON.stringify(staleWars, null, 2));
    roomA.send('clanWarChallenge', { clanId: 'clan-b' });
    await waitFor(() => noticesA.find(text => text.includes('объявлена война на 24 часа')), 'new challenge after stale war expiry');
    const afterNewChallenge = readJson(join(dataDir, 'clan_wars.json'));
    assert.equal(afterNewChallenge.find((war:any) => war.id === 'war-expired-stale').status, 'finished');
    assert.equal(afterNewChallenge.find((war:any) => war.id === 'war-expired-stale').winnerId, '');
    assert.equal(afterNewChallenge.filter((war:any) => war.status === 'active').length, 1);

    roomA.send('clanLeave');
    await waitFor(() => noticesA.find(text => text === 'Ты покинул клан.'), 'atomic last-member clan disband');
    const afterDisbandPlayers = readJson(join(dataDir, 'players.json'));
    const afterDisbandClans = readJson(join(dataDir, 'clans.json'));
    const afterDisbandWars = readJson(join(dataDir, 'clan_wars.json'));
    const afterDisbandTerritories = readJson(join(dataDir, 'clan_territories.json'));
    assert.equal(afterDisbandPlayers[playerA].clan, '');
    assert.equal(afterDisbandClans['clan-a'], undefined);
    assert.equal(afterDisbandWars[0].status, 'finished', 'completed wars remain in history');
    assert.equal(afterDisbandWars.find((war:any) => war.id === 'war-expired-stale').status, 'finished');
    assert.equal(afterDisbandWars.filter((war:any) => war.status === 'cancelled').length, 1, 'the new active war is cancelled on disband');
    assert.equal(afterDisbandTerritories[0].owner, '', 'disband releases territory ownership');

  } finally {
    await leaveRoomSafely(roomA);
    await leaveRoomSafely(roomB);
    await leaveRoomSafely(roomC);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
