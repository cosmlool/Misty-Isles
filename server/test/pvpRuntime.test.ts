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
  const targetIds = Array.from({ length: 9 }, (_, index) => `pvp_runtime_target_${index + 1}`);
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
        gold: 250, buff: 'attack', buffValue: 0.15, buffSecondaryEffect: 'crit', buffSecondaryValue: 0.12,
        buffUntil: Date.now() + 5 * 60 * 1000,
        inventory: '[]',
        equipment: JSON.stringify({ weapon: 'WPN-C-020', armor: 'ARM-C-2-020' }),
        equipmentEnhancements: JSON.stringify({ 'weapon:WPN-C-020': 5, 'armor:ARM-C-2-020': 3 }),
        collections: JSON.stringify({ equipmentProperties: {
          'WPN-C-020': { effect: 'attack', value: 0.1 },
          'ARM-C-2-020': { effect: 'defense', value: 0.2 },
        } }),
        quests: '{}',
      },
    };
    for (const [index, id] of targetIds.entries()) {
      players[id] = {
        id, name: `Offline Target ${index + 1}`, race: 'Собака', level: [20, 23, 10, 40, 15, 55, 8, 32, 60][index],
        strength: 1, dexterity: 1, defense: 100_000, vitality: 100_000,
        buff: 'defense', buffValue: 0.20, buffUntil: Date.now() + 5 * 60 * 1000,
        gold: 1_000 + index * 100, inventory: '[]',
        equipment: JSON.stringify({ weapon: 'WPN-C-020', armor: 'ARM-C-2-020' }),
        equipmentEnhancements: JSON.stringify({ 'weapon:WPN-C-020': 5, 'armor:ARM-C-2-020': 3 }),
        collections: JSON.stringify({ equipmentProperties: {
          'WPN-C-020': { effect: 'attack', value: 0.1 },
          'ARM-C-2-020': { effect: 'defense', value: 0.2 },
        } }),
        quests: '{}',
      };
    }
    const bystanderId = 'pvp_runtime_online_bystander';
    players[bystanderId] = {
      id: bystanderId, name: 'Online Bystander', race: 'Кот', level: 20,
      strength: 1, dexterity: 1, defense: 1, vitality: 1,
      health: 50, maxHealth: 100, gold: 500, inventory: '[]', equipment: '{}',
      quests: JSON.stringify({ hpRegenAt: Date.now() - 5 * 60 * 1000, pvp: { immunityUntil: Date.now() + 60 * 60 * 1000 } }),
    };
    players.pvp_runtime_no_character = {
      id: 'pvp_runtime_no_character', name: 'Uncreated Profile', race: '', level: 20, gold: 500, quests: '{}',
    };
    players.pvp_runtime_protected = {
      id: 'pvp_runtime_protected', name: 'Already Protected', race: 'Грызун', level: 20, gold: 500,
      quests: JSON.stringify({ pvp: { immunityUntil: Date.now() + 60 * 60 * 1000 } }),
    };
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify(players, null, 2));

    seedGuestCredentials(dataDir);


    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    const client = new Client(`ws://127.0.0.1:${port}`);
    const token = await guestToken(port, attackerId);
    attackerRoom = await client.joinOrCreate('my_room', { playerId: attackerId, sessionToken: token });
    const bystanderToken = await guestToken(port, bystanderId);
    secondRoom = await client.joinOrCreate('my_room', { playerId: bystanderId, sessionToken: bystanderToken });

    const offers: any[] = [];
    const results: any[] = [];
    const notices: string[] = [];
    attackerRoom.onMessage('pvpList', payload => offers.push(payload));
    attackerRoom.onMessage('pvpResult', payload => results.push(payload));
    attackerRoom.onMessage('notice', payload => notices.push(String(payload?.text || '')));

    attackerRoom.send('pvpChallenge', { targetId: 'bot_ember' });
    await waitFor(() => notices.find(message => message === 'Выбери другого соперника.'), 'reject unregistered training-bot IDs');
    assert.equal(readJson(join(dataDir, 'players.json'))[attackerId].lastPvpAt || 0, 0, 'invalid bot target must not consume a PvP turn');

    // Simulate a committed shared-WAL transaction becoming pending after both
    // characters are online. The PvP listing must recover it before preparing
    // its player snapshot, then refresh the live Player objects from disk.
    const recoveredPlayers = readJson(join(dataDir, 'players.json'));
    recoveredPlayers[attackerId].gold = 777;
    writeFileSync(join(dataDir, 'shared_state_transaction.json'), JSON.stringify({
      version: 1,
      files: { players: recoveredPlayers },
    }));

    attackerRoom.send('pvpList');
    const firstOffer = await waitFor(() => offers[0], 'four real opponents after shared-WAL recovery');
    assert.equal(readJson(join(dataDir, 'players.json'))[attackerId].gold, 777,
      'PvP listing must not overwrite a recovered player snapshot with stale online state');
    assert.equal(firstOffer.players.length, 4);
    assert.equal(new Set(firstOffer.players.map((player: any) => player.id)).size, 4);
    assert.ok(firstOffer.players.every((player: any) => player.isBot === false));
    assert.ok(firstOffer.players.some((player: any) => player.level > 22 || player.level < 18), 'matchmaking must not restrict level difference');
    assert.ok(!firstOffer.players.some((player: any) => player.id === publicCode('pvp_runtime_protected')));
    assert.ok(!firstOffer.players.some((player: any) => player.id === publicCode(bystanderId)), 'protected online bystander must not enter the opponent list');
    const chosen = firstOffer.players[0];
    const targetId = targetIds.find(id => publicCode(id) === chosen.id);
    assert.ok(targetId, 'the offered target must be one of the offline saved characters');
    let challengeRecovery = readJson(join(dataDir, 'players.json'));
    challengeRecovery[attackerId].gold = 888;
    challengeRecovery[targetId].gold = Number(challengeRecovery[targetId].gold || 0) + 100;
    writeFileSync(join(dataDir, 'shared_state_transaction.json'), JSON.stringify({
      version: 1,
      files: { players: challengeRecovery },
    }));
    const targetBefore = challengeRecovery[targetId];

    attackerRoom.send('pvpChallenge', { targetId: chosen.id });
    const result = await waitFor(() => results[0], 'PvP combat result');
    assert.equal(result.report.result, 'win', 'the synthetic high-stat attacker should win');
    assert.ok(result.report.attack >= 202_441 && result.report.attack <= 202_452,
      'weapon attack property, +5 sharpening and active +15% attack buff must all reach the live PvP calculation');
    assert.equal(result.report.defense, 174_041,
      'armor defense property and +3 armor sharpening must reach the live PvP calculation');
    assert.ok(result.report.scores.player >= 296_352,
      'secondary critical buff must increase the gear-adjusted PvP combat score');
    assert.ok(result.report.scores.opponent >= 83_578,
      'the target weapon/armor properties, sharpening and active +20% defense buff must affect its PvP score');
    const saved = readJson(join(dataDir, 'players.json'));
    assert.ok(saved[bystanderId].health > 50, 'PvP persistence must include unsaved health regeneration from every online character');
    const stolen = Math.floor(targetBefore.gold * 0.2);
    assert.equal(saved[attackerId].gold, 888 + stolen, 'PvP challenge must calculate rewards from recovered attacker gold');
    assert.equal(saved[targetId].gold, targetBefore.gold - stolen);
    assert.equal(result.report.rewards.gold, stolen);
    assert.equal(saved[attackerId].lastPvpAt > 0, true);
    const victimPvp = JSON.parse(saved[targetId].quests).pvp;
    assert.ok(victimPvp.immunityUntil >= Date.now() + 59 * 60 * 1000);
    const attackerPvp = JSON.parse(saved[attackerId].quests).pvp;
    assert.deepEqual(attackerPvp.offeredIds, []);
    assert.equal(attackerPvp.previousOfferedIds.length, 4);
    assert.ok(attackerPvp.previousOfferedIds.includes(targetId));

    const cooldownOffer = await waitFor(() => offers.find(payload => Number(payload.cooldownUntil) > Date.now()), 'attacker cooldown refresh');
    assert.equal(cooldownOffer.players.length, 0);
    attackerRoom.send('pvpChallenge', { targetId: chosen.id });
    await waitFor(() => notices.find(message => message.startsWith('Следующая атака через')), 'server-side fifteen-minute cooldown');
    assert.equal(readJson(join(dataDir, 'players.json'))[attackerId].gold, saved[attackerId].gold,
      'a repeated challenge during cooldown must not transfer gold or grant rewards again');

    // Restart the isolated server with the persisted attacker session after advancing
    // only the test fixture's attack timestamp beyond the fifteen-minute cooldown.
    const previousOfferIds = firstOffer.players.map((player: any) => player.id);
    await attackerRoom.leave();
    attackerRoom = undefined;
    await stopServer(child);
    const afterCooldown = readJson(join(dataDir, 'players.json'));
    afterCooldown[attackerId].lastPvpAt = Date.now() - 15 * 60 * 1000 - 1;
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify(afterCooldown, null, 2));
    seedGuestCredentials(dataDir);

    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    attackerRoom = await client.joinOrCreate('my_room', { playerId: attackerId, sessionToken: token });
    const rotatedOffers: any[] = [];
    attackerRoom.onMessage('pvpList', payload => rotatedOffers.push(payload));
    attackerRoom.send('pvpList');
    const rotated = await waitFor(() => rotatedOffers[0], 'new opponents after cooldown');
    assert.equal(rotated.players.length, 4);
    assert.ok(rotated.players.every((player: any) => !previousOfferIds.includes(player.id)), 'the next list must use different characters when at least four alternatives exist');
    assert.ok(rotated.players.some((player: any) => player.level > 22 || player.level < 18), 'the next list still includes all level ranges');
    assert.equal(rotated.cooldownUntil, 0);

  } finally {
    await leaveRoomSafely(attackerRoom);
    await leaveRoomSafely(secondRoom);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
