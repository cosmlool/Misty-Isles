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

import { seedGuestCredentials, testGuestProof } from './guestAuthTestHelpers.js';

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

test('clan donation refreshes clan balance and shared quest progress for every online member', { timeout: 60_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-clan-broadcast-'));
  const ids = ['runtime_clan_broadcast_lead', 'runtime_clan_broadcast_member'];
  const clanId = 'clan_runtime_broadcast';
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  const rooms: Room[] = [];
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    const player = (id: string, name: string) => ({
      id, name, race: 'Кот', profession: '', level: 20, gold: 500,
      inventory: '[]', equipment: '{}', quests: '{}', collections: '{}',
    });
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [ids[0]]: player(ids[0], 'Clan Leader'),
      [ids[1]]: player(ids[1], 'Clan Member'),
    }, null, 2));
    writeFileSync(join(dataDir, 'clans.json'), JSON.stringify({
      [clanId]: {
        id: clanId, name: 'Broadcast Test', leader: ids[0], level: 1, xp: 0, vault: 0,
        upgrades: { barracks: 0, treasury: 0, banner: 0 }, seasonPoints: 0,
        members: [
          { id: ids[0], name: 'Clan Leader', role: 'Лидер', contribution: 0 },
          { id: ids[1], name: 'Clan Member', role: 'Участник', contribution: 0 },
        ],
      },
    }, null, 2));
    writeFileSync(join(dataDir, 'clan_wars.json'), '[]');
    writeFileSync(join(dataDir, 'clan_territories.json'), '[]');

    const seeded = JSON.parse(readFileSync(join(dataDir, 'players.json'), 'utf8'));
    for (const id of ids) seeded[id].clan = clanId;
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify(seeded, null, 2));

    seedGuestCredentials(dataDir);


    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    const client = new Client(`ws://127.0.0.1:${port}`);
    const connected: Record<string, Room> = {};
    for (const id of ids) {
      const token = await guestToken(port, id);
      connected[id] = await client.joinOrCreate('my_room', { playerId: id, sessionToken: token });
      rooms.push(connected[id]);
    }

    const memberClanLists: any[] = [];
    const memberClanQuests: any[] = [];
    connected[ids[1]].onMessage('clanList', payload => memberClanLists.push(payload));
    connected[ids[1]].onMessage('clanQuests', payload => memberClanQuests.push(payload));
    connected[ids[0]].send('clanDonate', { amount: 100 });

    const list = await waitFor(
      () => memberClanLists.find(payload => payload.clans?.some((clan: any) => clan.id === clanId && clan.vault === 100)),
      'updated clan balance for second member',
    );
    assert.equal(list.clans.find((clan: any) => clan.id === clanId).members, 2);
    const quests = await waitFor(
      () => memberClanQuests.find(payload => payload.quests?.some((quest: any) => quest.id === 'donate' && quest.progress === 100)),
      'updated shared donation quest for second member',
    );
    assert.equal(quests.quests.find((quest: any) => quest.id === 'donate').progress, 100);
    const saved = JSON.parse(readFileSync(join(dataDir, 'clans.json'), 'utf8'))[clanId];
    assert.equal(saved.vault, 100);
    assert.equal(saved.questProgress.donate, 100);
  } finally {
    for (const room of rooms) await room.leave().catch(() => undefined);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
