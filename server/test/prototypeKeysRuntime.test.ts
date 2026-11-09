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

async function waitFor<T>(read: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await delay(25);
  }
  throw new Error(label + ' timed out.');
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('prototype property names cannot bypass stat or clan upgrade validation', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-prototype-keys-'));
  const playerId = 'runtime_prototype_keys_01';
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let room: Room | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [playerId]: {
        id: playerId, name: 'Prototype Key Tester', race: 'Кот', level: 1,
        strength: 10, defense: 8, vitality: 10, gold: 10_000, goldSpent: 0,
        clan: 'clan-prototype', inventory: '[]', equipment: '{}', quests: '{}',
      },
    }, null, 2));
    writeFileSync(join(dataDir, 'clans.json'), JSON.stringify({
      'clan-prototype': {
        id: 'clan-prototype', name: 'Synthetic Clan', leader: playerId, level: 1,
        vault: 5_000, members: [{ id: playerId, name: 'Prototype Key Tester' }],
        upgrades: { barracks: 0, treasury: 0, banner: 0 },
      },
    }, null, 2));

    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    const client = new Client(`ws://127.0.0.1:${port}`);
    const token = await guestToken(port, playerId);
    room = await client.joinOrCreate('my_room', { playerId, sessionToken: token });
    const notices: string[] = [];
    room.onMessage('notice', payload => notices.push(String(payload?.text || '')));

    for (const stat of ['toString', 'constructor', '__proto__']) {
      const before = notices.length;
      room.send('upgradeStat', { stat });
      await waitFor(() => notices.slice(before).find(message => message === 'Такой характеристики нет.'), 'invalid stat key rejection');
    }
    for (const upgrade of ['toString', 'constructor', '__proto__']) {
      const before = notices.length;
      room.send('clanUpgrade', { upgrade });
      await waitFor(() => notices.slice(before).find(message => message === 'Неизвестная ветка улучшения.'), 'invalid clan upgrade key rejection');
    }

    const player = readJson(join(dataDir, 'players.json'))[playerId];
    const clan = readJson(join(dataDir, 'clans.json'))['clan-prototype'];
    assert.equal(player.gold, 10_000);
    assert.equal(player.goldSpent, 0);
    assert.equal(player.strength, 10);
    assert.equal(clan.vault, 5_000);
    assert.deepEqual(clan.upgrades, { barracks: 0, treasury: 0, banner: 0 });
  } finally {
    if (room) await room.leave().catch(() => undefined);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
