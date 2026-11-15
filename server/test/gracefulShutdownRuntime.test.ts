import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

function startServer(dataDir: string, port: number, token: string): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port), MISTY_SHUTDOWN_TOKEN: token },
    stdio: 'ignore',
  });
}

async function waitForServer(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Isolated test server exited during startup.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/auth/check`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'invalid' }),
      });
      if (response.status === 401) return;
    } catch {}
    await delay(100);
  }
  throw new Error('Isolated test server did not become ready.');
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>(resolve => child.once('exit', () => resolve())),
    delay(timeoutMs).then(() => { throw new Error('Server process did not exit in time.'); }),
  ]);
}

async function stopServer(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try { await waitForExit(child, 5_000); }
  catch {
    child.kill('SIGKILL');
    await waitForExit(child, 5_000).catch(() => undefined);
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

test('local shutdown saves online players, releases the data lock, and blocks a second server', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-graceful-shutdown-'));
  const port = await unusedPort();
  const secondPort = await unusedPort();
  const token = 'a'.repeat(64);
  let child: ChildProcess | undefined;
  let second: ChildProcess | undefined;
  let room: Room | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    child = startServer(dataDir, port, token);
    await waitForServer(port, child);

    const lockFile = join(dataDir, '.misty-server.lock');
    assert.equal(existsSync(lockFile), true, 'the running server must own the data directory lock');

    second = startServer(dataDir, secondPort, 'b'.repeat(64));
    await waitForExit(second, 5_000);
    assert.notEqual(second.exitCode, 0, 'a second server must fail to start against the same data directory');

    const unauthorized = await fetch(`http://127.0.0.1:${port}/internal/shutdown`, {
      method: 'POST', headers: { 'x-misty-shutdown-token': 'wrong-token' },
    });
    assert.equal(unauthorized.status, 404, 'shutdown must reject an invalid token');
    assert.equal((await fetch(`http://127.0.0.1:${port}/auth/check`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'invalid' }),
    })).status, 401, 'invalid shutdown request must leave the server running');

    const guestResponse = await fetch(`http://127.0.0.1:${port}/auth/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(guestResponse.status, 200);
    const guest = await guestResponse.json() as { playerId: string; token: string };
    const client = new Client(`ws://127.0.0.1:${port}`);
    room = await client.joinOrCreate('my_room', { playerId: guest.playerId, sessionToken: guest.token });
    const notices: string[] = [];
    room.onMessage('notice', payload => notices.push(String(payload?.text || '')));
    room.send('createCharacter', { race: 'Кот', gender: 'male', name: 'ShutdownSaveHero' });
    await waitFor(() => notices.find(message => message.includes('Персонаж создан')), 'character creation');

    const shutdown = await fetch(`http://127.0.0.1:${port}/internal/shutdown`, {
      method: 'POST', headers: { 'x-misty-shutdown-token': token },
    });
    assert.equal(shutdown.status, 202);
    await waitForExit(child, 15_000);

    assert.equal(existsSync(lockFile), false, 'graceful process exit must release the data directory lock');
    const players = JSON.parse(readFileSync(join(dataDir, 'players.json'), 'utf8'));
    assert.equal(players[guest.playerId]?.name, 'ShutdownSaveHero');
    assert.equal(players[guest.playerId]?.race, 'Кот');
  } finally {
    if (room) await Promise.race([room.leave().catch(() => undefined), delay(500)]);
    await stopServer(second);
    await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
