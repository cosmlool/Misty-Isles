import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
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

async function post(port: number, path: string, body: any) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('logout only revokes a valid session and invalid logout requests do not revoke other sessions', { timeout: 30_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-auth-logout-'));
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);

    const guest = await post(port, '/auth/guest', { playerId: 'runtime_auth_logout_01' });
    assert.equal(guest.status, 200);
    const { token } = await guest.json() as { token: string };

    const invalidLogout = await post(port, '/auth/logout', { token: 'not-a-session-token' });
    assert.equal(invalidLogout.status, 401);
    const stillValid = await post(port, '/auth/check', { token });
    assert.equal(stillValid.status, 200);

    const validLogout = await post(port, '/auth/logout', { token });
    assert.equal(validLogout.status, 200);
    const revoked = await post(port, '/auth/check', { token });
    assert.equal(revoked.status, 401);

    const repeatedLogout = await post(port, '/auth/logout', { token });
    assert.equal(repeatedLogout.status, 401);
  } finally {
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
