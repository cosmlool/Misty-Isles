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
    body: JSON.stringify({ playerId }),
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

function publicCode(id: string): string {
  return createHash('sha256').update(`MistyIslesPublic:${id}`).digest('hex').slice(0, 24);
}

test('PvP offers four saved real characters, steals 20 percent gold, persists cooldown and grants one-hour victim immunity', { timeout: 60_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-pvp-runtime-'));
  const attackerId = 'pvp_runtime_attacker';
  const targetIds = Array.from({ length: 5 }, (_, index) => `pvp_runtime_target_${index + 1}`);
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let attackerRoom: Room | undefined;
  let secondRoom: Room | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    const players: Record<string, any> = {
      [attackerId]: {
        id: attackerId, name: 'PvP Attacker', race: 'Кот', level: 20,
        strength: 100_000, dexterity: 100_000, defense: 100_000, vitality: 100_000,
        gold: 250, inventory: '[]', equipment: '{}', quests: '{}',
      },
    };
    for (const [index, id] of targetIds.entries()) {
      players[id] = {
        id, name: `Offline Target ${index + 1}`, race: 'Собака', level: 20,
        strength: 1, dexterity: 1, defense: 1, vitality: 1,
        gold: 1_000 + index * 100, inventory: '[]', equipment: '{}', quests: '{}',
      };
    }
    players.pvp_runtime_out_of_range = {
      id: 'pvp_runtime_out_of_range', name: 'Too Strong Target', race: 'Птица', level: 23, gold: 500, quests: '{}',
    };
    players.pvp_runtime_no_character = {
      id: 'pvp_runtime_no_character', name: 'Uncreated Profile', race: '', level: 20, gold: 500, quests: '{}',
    };
    players.pvp_runtime_protected = {
      id: 'pvp_runtime_protected', name: 'Already Protected', race: 'Грызун', level: 20, gold: 500,
      quests: JSON.stringify({ pvp: { immunityUntil: Date.now() + 60 * 60 * 1000 } }),
    };
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify(players, null, 2));

    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    const client = new Client(`ws://127.0.0.1:${port}`);
    const token = await guestToken(port, attackerId);
    attackerRoom = await client.joinOrCreate('my_room', { playerId: attackerId, sessionToken: token });

    const offers: any[] = [];
    const results: any[] = [];
    const notices: string[] = [];
    attackerRoom.onMessage('pvpList', payload => offers.push(payload));
    attackerRoom.onMessage('pvpResult', payload => results.push(payload));
    attackerRoom.onMessage('notice', payload => notices.push(String(payload?.text || '')));

    attackerRoom.send('pvpList');
    const firstOffer = await waitFor(() => offers[0], 'four real opponents');
    assert.equal(firstOffer.players.length, 4);
    assert.equal(new Set(firstOffer.players.map((player: any) => player.id)).size, 4);
    assert.ok(firstOffer.players.every((player: any) => player.isBot === false));
    assert.ok(firstOffer.players.every((player: any) => player.level >= 18 && player.level <= 22));
    assert.ok(firstOffer.players.every((player: any) => !targetIds.includes('pvp_runtime_protected') || player.id !== publicCode('pvp_runtime_protected')));
    const chosen = firstOffer.players[0];
    const targetId = targetIds.find(id => publicCode(id) === chosen.id);
    assert.ok(targetId, 'the offered target must be one of the offline saved characters');
    const targetBefore = readJson(join(dataDir, 'players.json'))[targetId];

    attackerRoom.send('pvpChallenge', { targetId: chosen.id });
    const result = await waitFor(() => results[0], 'PvP combat result');
    assert.equal(result.report.result, 'win', 'the synthetic high-stat attacker should win');
    const saved = readJson(join(dataDir, 'players.json'));
    const stolen = Math.floor(targetBefore.gold * 0.2);
    assert.equal(saved[attackerId].gold, 250 + stolen);
    assert.equal(saved[targetId].gold, targetBefore.gold - stolen);
    assert.equal(result.report.rewards.gold, stolen);
    assert.equal(saved[attackerId].lastPvpAt > 0, true);
    const victimPvp = JSON.parse(saved[targetId].quests).pvp;
    assert.ok(victimPvp.immunityUntil >= Date.now() + 59 * 60 * 1000);
    assert.deepEqual(JSON.parse(saved[attackerId].quests).pvp.offeredIds, []);

    const cooldownOffer = await waitFor(() => offers.find(payload => Number(payload.cooldownUntil) > Date.now()), 'attacker cooldown refresh');
    assert.equal(cooldownOffer.players.length, 0);
    attackerRoom.send('pvpChallenge', { targetId: chosen.id });
    await waitFor(() => notices.find(message => message.startsWith('Следующая атака через')), 'server-side fifteen-minute cooldown');

    // Add a second real character after the first fight. The server reads the saved roster,
    // so this player can see the protected offline victim excluded from matchmaking.
    const secondId = 'pvp_runtime_second_attacker';
    const updatedPlayers = readJson(join(dataDir, 'players.json'));
    updatedPlayers[secondId] = {
      id: secondId, name: 'Second Attacker', race: 'Кот', level: 20,
      strength: 10, defense: 10, gold: 100, inventory: '[]', equipment: '{}', quests: '{}',
    };
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify(updatedPlayers, null, 2));
    const secondToken = await guestToken(port, secondId);
    secondRoom = await client.joinOrCreate('my_room', { playerId: secondId, sessionToken: secondToken });
    const secondOffers: any[] = [];
    secondRoom.onMessage('pvpList', payload => secondOffers.push(payload));
    secondRoom.send('pvpList');
    const secondOffer = await waitFor(() => secondOffers[0], 'second attacker matchmaking');
    assert.equal(secondOffer.players.length, 4);
    assert.ok(!secondOffer.players.some((player: any) => player.id === chosen.id), 'a victim must not appear in matchmaking during the one-hour immunity');

  } finally {
    if (attackerRoom) await attackerRoom.leave().catch(() => undefined);
    if (secondRoom) await secondRoom.leave().catch(() => undefined);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
