import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, type Room } from 'colyseus.js';
import test from 'node:test';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticDataFiles = ['city_npcs.json', 'equipment_catalog.json', 'forgotten_lands.json'];

function makePlayer(id: string, name: string, gold: number, inventory: string[]) {
  return {
    id, name, race: 'Кот', profession: 'Ассасин', level: 1,
    gold, crystals: 100, inventory: JSON.stringify(inventory),
    equipment: JSON.stringify({ weapon: '', helmet: '', armor: '', gloves: '', boots: '', cloak: '', amulet: '' }),
    quests: '{}', collections: '{}', craftQueue: '[]',
  };
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function unusedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => resolve());
  });
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Test server exited during startup.');
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/auth/check', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'not-a-real-token' }),
      });
      if (response.status === 401) return;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error('Test server did not become ready: ' + String(lastError));
}

function startServer(dataDir: string, port: number): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>(resolve => child.once('exit', () => resolve())),
    delay(5_000).then(() => { child.kill('SIGKILL'); }),
  ]);
}

async function guestToken(port: number, playerId: string): Promise<string> {
  const response = await fetch('http://127.0.0.1:' + port + '/auth/guest', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId }),
  });
  assert.equal(response.status, 200, 'synthetic guest session should be issued');
  const payload = await response.json() as { token: string };
  assert.ok(payload.token);
  return payload.token;
}

async function connect(port: number, playerId: string, token: string): Promise<{ client: Client; room: Room }> {
  const client = new Client('ws://127.0.0.1:' + port);
  const room = await client.joinOrCreate('my_room', { playerId, sessionToken: token });
  return { client, room };
}

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  assert.fail('Timed out waiting for ' + description);
}

test('live Colyseus auction flows preserve both players through disconnect and server restart', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-runtime-economy-'));
  assert.ok(dataDir.startsWith(tmpdir()), 'runtime data must live under the OS temp directory');
  assert.notEqual(dataDir, join(serverDir, 'data'), 'runtime test must never use production server/data');
  let child: ChildProcess | undefined;
  const rooms: Room[] = [];
  const clients: Client[] = [];
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    const sellerId = 'runtime_seller_0001';
    const buyerId = 'runtime_buyer_00001';
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [sellerId]: makePlayer(sellerId, 'Runtime Seller', 1000, ['WPN-C-001', 'WPN-C-004']),
      [buyerId]: makePlayer(buyerId, 'Runtime Buyer', 2000, []),
    }, null, 2));

    const port = await unusedPort();
    child = startServer(dataDir, port);
    await waitForServer(port, child);
    const sellerToken = await guestToken(port, sellerId);
    const buyerToken = await guestToken(port, buyerId);
    const seller = await connect(port, sellerId, sellerToken);
    rooms.push(seller.room); clients.push(seller.client);
    const buyer = await connect(port, buyerId, buyerToken);
    rooms.push(buyer.room); clients.push(buyer.client);

    seller.room.send('auctionSell', { index: 0, itemId: 'WPN-C-001', expectedCount: 1, price: 500, currency: 'gold' });
    await waitFor(() => {
      const lots = readJson(join(dataDir, 'auction.json'));
      return Array.isArray(lots) && lots.length === 1;
    }, 'seller listing to persist');

    await seller.room.leave();
    const lot = readJson(join(dataDir, 'auction.json'))[0];
    buyer.room.send('auctionBuy', { id: lot.id });
    await waitFor(() => {
      const players = readJson(join(dataDir, 'players.json'));
      return Array.isArray(JSON.parse(players[buyerId].inventory))
        && JSON.parse(players[buyerId].inventory).includes('WPN-C-001')
        && readJson(join(dataDir, 'auction.json')).length === 0;
    }, 'offline seller purchase to commit');

    let saved = readJson(join(dataDir, 'players.json'));
    assert.equal(saved[buyerId].gold, 1500);
    assert.equal(saved[sellerId].gold, 1465);
    assert.deepEqual(JSON.parse(saved[buyerId].inventory), ['WPN-C-001']);
    assert.deepEqual(JSON.parse(saved[sellerId].inventory), ['WPN-C-004']);

    const sellerAgain = await connect(port, sellerId, sellerToken);
    rooms.push(sellerAgain.room); clients.push(sellerAgain.client);
    sellerAgain.room.send('auctionSell', { index: 0, itemId: 'WPN-C-004', expectedCount: 1, price: 100, currency: 'gold' });
    await waitFor(() => readJson(join(dataDir, 'auction.json')).length === 1, 'second listing to persist');
    const withdrawalLot = readJson(join(dataDir, 'auction.json'))[0];
    sellerAgain.room.send('auctionCancel', { id: withdrawalLot.id });
    await waitFor(() => readJson(join(dataDir, 'auction.json')).length === 0
      && JSON.parse(readJson(join(dataDir, 'players.json'))[sellerId].inventory).includes('health_potion'), 'withdrawal to return the item');

    saved = readJson(join(dataDir, 'players.json'));
    assert.equal(saved[sellerId].gold, 1463, 'withdrawal does not refund the listing fee');
    assert.deepEqual(JSON.parse(saved[sellerId].inventory), ['health_potion']);

    await Promise.all(rooms.map(room => room.leave().catch(() => undefined)));
    rooms.length = 0;
    await stopServer(child);
    child = undefined;

    const restarted = startServer(dataDir, port);
    child = restarted;
    await waitForServer(port, restarted);
    const buyerAfterRestart = await connect(port, buyerId, buyerToken);
    rooms.push(buyerAfterRestart.room); clients.push(buyerAfterRestart.client);
    const sellerAfterRestart = await connect(port, sellerId, sellerToken);
    rooms.push(sellerAfterRestart.room); clients.push(sellerAfterRestart.client);

    saved = readJson(join(dataDir, 'players.json'));
    assert.equal(saved[buyerId].gold, 1500);
    assert.equal(saved[sellerId].gold, 1463);
    assert.deepEqual(JSON.parse(saved[buyerId].inventory), ['wood_sword']);
    assert.deepEqual(JSON.parse(saved[sellerId].inventory), ['health_potion']);
    assert.equal(readJson(join(dataDir, 'auction.json')).length, 0);
  } finally {
    await Promise.all(rooms.map(room => room.leave().catch(() => undefined)));
    await Promise.all(clients.map(client => client.close()));
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
