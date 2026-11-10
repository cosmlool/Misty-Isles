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

import { seedGuestCredentials, testGuestProof } from './guestAuthTestHelpers.js';

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

function startServer(dataDir: string, port: number, output: string[]): ChildProcess {
  seedGuestCredentials(dataDir);
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', chunk => { output.push('[stdout] ' + String(chunk)); });
  child.stderr?.on('data', chunk => { output.push('[stderr] ' + String(chunk)); });
  return child;
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

async function guestToken(port: number, playerId: string): Promise<string> {
  const response = await fetch('http://127.0.0.1:' + port + '/auth/guest', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId, guestProof: testGuestProof(playerId) }),
  });
  assert.equal(response.status, 200, 'synthetic guest session should be issued');
  const payload = await response.json() as { token: string };
  assert.ok(payload.token);
  return payload.token;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function connect(port: number, playerId: string, token: string): Promise<{ client: Client; room: Room }> {
  const client = new Client('ws://127.0.0.1:' + port);
  const room = await withTimeout(
    client.joinOrCreate('my_room', { playerId, sessionToken: token }),
    12_000,
    'Colyseus room join for ' + playerId,
  );
  return { client, room };
}

async function leaveRoom(room: Room): Promise<void> {
  await withTimeout(room.leave(), 3_000, 'Colyseus room leave').catch(() => undefined);
}

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return;
    } catch (error) {
      // Files may not exist until the server completes the first write.
      lastError = error;
    }
    await delay(50);
  }
  assert.fail('Timed out waiting for ' + description + (lastError ? ': ' + String(lastError) : ''));
}

test('live Colyseus auction flows preserve both players through disconnect and server restart', { timeout: 90_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-runtime-economy-'));
  assert.ok(dataDir.startsWith(tmpdir()), 'runtime data must live under the OS temp directory');
  assert.notEqual(dataDir, join(serverDir, 'data'), 'runtime test must never use production server/data');
  let child: ChildProcess | undefined;
  const rooms: Room[] = [];
  const serverOutput: string[] = [];
  let stage = 'creating isolated test data';
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    const sellerId = 'runtime_seller_0001';
    const buyerId = 'runtime_buyer_00001';
    const secondBuyerId = 'runtime_buyer_00002';
    let concurrentWinnerId = '';
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [sellerId]: makePlayer(sellerId, 'Runtime Seller', 1000, ['WPN-C-001', 'WPN-C-004']),
      [buyerId]: makePlayer(buyerId, 'Runtime Buyer One', 2000, []),
      [secondBuyerId]: makePlayer(secondBuyerId, 'Runtime Buyer Two', 2000, []),
    }, null, 2));

    stage = 'starting isolated server';
    const port = await unusedPort();
    child = startServer(dataDir, port, serverOutput);
    await waitForServer(port, child);
    stage = 'authenticating synthetic seller';
    const sellerToken = await guestToken(port, sellerId);
    stage = 'authenticating synthetic buyer';
    const buyerToken = await guestToken(port, buyerId);
    stage = 'connecting seller to Colyseus';
    const seller = await connect(port, sellerId, sellerToken);
    rooms.push(seller.room);
    stage = 'connecting first buyer to Colyseus';
    const buyer = await connect(port, buyerId, buyerToken);
    rooms.push(buyer.room);
    stage = 'authenticating and connecting second synthetic buyer';
    const secondBuyerToken = await guestToken(port, secondBuyerId);
    const secondBuyer = await connect(port, secondBuyerId, secondBuyerToken);
    rooms.push(secondBuyer.room);

    stage = 'seller listing auction item';
    seller.room.send('auctionSell', { index: 0, itemId: 'WPN-C-001', expectedCount: 1, price: 500, currency: 'gold' });
    await waitFor(() => {
      const lots = readJson(join(dataDir, 'auction.json'));
      return Array.isArray(lots) && lots.length === 1;
    }, 'seller listing to persist');

    stage = 'disconnecting seller before purchase';
    await leaveRoom(seller.room);
    const lot = readJson(join(dataDir, 'auction.json'))[0];
    stage = 'two buyers sending concurrent purchase requests for the same offline-seller lot';
    buyer.room.send('auctionBuy', { id: lot.id });
    secondBuyer.room.send('auctionBuy', { id: lot.id });
    await waitFor(() => {
      const players = readJson(join(dataDir, 'players.json'));
      const firstHasItem = JSON.parse(players[buyerId].inventory).includes('WPN-C-001');
      const secondHasItem = JSON.parse(players[secondBuyerId].inventory).includes('WPN-C-001');
      if (firstHasItem !== secondHasItem && readJson(join(dataDir, 'auction.json')).length === 0) {
        concurrentWinnerId = firstHasItem ? buyerId : secondBuyerId;
        return true;
      }
      return false;
    }, 'exactly one concurrent buyer to complete the purchase');

    let saved = readJson(join(dataDir, 'players.json'));
    const losingBuyerId = concurrentWinnerId === buyerId ? secondBuyerId : buyerId;
    assert.equal(saved[concurrentWinnerId].gold, 1500, 'only the winning buyer pays the lot price');
    assert.equal(saved[losingBuyerId].gold, 2000, 'the rejected buyer keeps all currency');
    assert.equal(saved[sellerId].gold, 1465, 'seller receives the net proceeds exactly once');
    assert.deepEqual(JSON.parse(saved[concurrentWinnerId].inventory), ['WPN-C-001']);
    assert.deepEqual(JSON.parse(saved[losingBuyerId].inventory), []);
    assert.deepEqual(JSON.parse(saved[sellerId].inventory), ['WPN-C-004']);
    assert.equal(readJson(join(dataDir, 'auction_history.json')).filter((entry: any) => entry.lotId === lot.id && entry.status === 'completed').length, 1,
      'the lot produces exactly one completed sale history entry');

    stage = 'reconnecting seller after offline purchase';
    const sellerAgain = await connect(port, sellerId, sellerToken);
    rooms.push(sellerAgain.room);
    stage = 'seller listing second item';
    sellerAgain.room.send('auctionSell', { index: 0, itemId: 'WPN-C-004', expectedCount: 1, price: 100, currency: 'gold' });
    await waitFor(() => readJson(join(dataDir, 'auction.json')).length === 1, 'second listing to persist');
    const withdrawalLot = readJson(join(dataDir, 'auction.json'))[0];
    stage = 'seller withdrawing second listing';
    sellerAgain.room.send('auctionCancel', { id: withdrawalLot.id });
    await waitFor(() => readJson(join(dataDir, 'auction.json')).length === 0
      && JSON.parse(readJson(join(dataDir, 'players.json'))[sellerId].inventory).includes('WPN-C-004'), 'withdrawal to return the item');

    saved = readJson(join(dataDir, 'players.json'));
    assert.equal(saved[sellerId].gold, 1463, 'withdrawal does not refund the listing fee');
    assert.deepEqual(JSON.parse(saved[sellerId].inventory), ['WPN-C-004']);

    stage = 'closing client rooms before server restart';
    await Promise.all(rooms.map(leaveRoom));
    rooms.length = 0;
    stage = 'stopping first server process';
    await stopServer(child);
    child = undefined;

    stage = 'restarting isolated server';
    const restarted = startServer(dataDir, port, serverOutput);
    child = restarted;
    await waitForServer(port, restarted);
    stage = 'reconnecting both buyers after server restart';
    const buyerAfterRestart = await connect(port, buyerId, buyerToken);
    rooms.push(buyerAfterRestart.room);
    const secondBuyerAfterRestart = await connect(port, secondBuyerId, secondBuyerToken);
    rooms.push(secondBuyerAfterRestart.room);
    stage = 'reconnecting seller after server restart';
    const sellerAfterRestart = await connect(port, sellerId, sellerToken);
    rooms.push(sellerAfterRestart.room);

    saved = readJson(join(dataDir, 'players.json'));
    assert.equal(saved[concurrentWinnerId].gold, 1500);
    assert.equal(saved[concurrentWinnerId === buyerId ? secondBuyerId : buyerId].gold, 2000);
    assert.equal(saved[sellerId].gold, 1463);
    assert.deepEqual(JSON.parse(saved[concurrentWinnerId].inventory), ['WPN-C-001']);
    assert.deepEqual(JSON.parse(saved[concurrentWinnerId === buyerId ? secondBuyerId : buyerId].inventory), []);
    assert.deepEqual(JSON.parse(saved[sellerId].inventory), ['WPN-C-004']);
    assert.equal(readJson(join(dataDir, 'auction.json')).length, 0);
  } catch (error) {
    const diagnostics = serverOutput.join('').slice(-12_000);
    throw new Error('Runtime integration failed during stage: ' + stage + '\n' + String(error)
      + (diagnostics ? '\n--- test server output (last 12 KB) ---\n' + diagnostics : '\n--- test server produced no captured output ---'));
  } finally {
    await Promise.all(rooms.map(leaveRoom));
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
