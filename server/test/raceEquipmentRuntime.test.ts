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

const professionRuntimeProfiles = [
  { playerId: 'runtime_profession_mage', race: 'Кот', profession: 'Боевой маг', weaponId: 'WPN-МАГ-025', weaponName: 'Звёздный посох' },
  { playerId: 'runtime_profession_assassin', race: 'Кот', profession: 'Ассасин', weaponId: 'WPN-АСС-025', weaponName: 'Безмолвный кинжал' },
  { playerId: 'runtime_profession_knight', race: 'Собака', profession: 'Рыцарь', weaponId: 'WPN-ВОИ-025', weaponName: 'Клятвенный меч' },
  { playerId: 'runtime_profession_buffer', race: 'Собака', profession: 'Баффер', weaponId: 'WPN-ПОД-025', weaponName: 'Живительный жезл' },
  { playerId: 'runtime_profession_archer', race: 'Птица', profession: 'Лучник', weaponId: 'WPN-ЛУЧ-025', weaponName: 'Дальний лук' },
  { playerId: 'runtime_profession_bird_assassin', race: 'Птица', profession: 'Ассасин птицы', weaponId: 'WPN-BIRD-ASS-025', weaponName: 'Кинжал ветреной тени' },
  { playerId: 'runtime_profession_vampire', race: 'Грызун', profession: 'Вампир', weaponId: 'WPN-ВАМ-025', weaponName: 'Алый клык' },
  { playerId: 'runtime_profession_gatherer', race: 'Грызун', profession: 'Добытчик', weaponId: 'WPN-ДОБ-025', weaponName: 'Шахтёрский кирку' },
] as const;

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

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('server preserves race equipment rules, migrates Warrior to Knight and enables Bird Assassin', { timeout: 120_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-race-equipment-'));
  const playerId = 'runtime_race_equipment_01';
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let room: Room | undefined;
  let birdRoom: Room | undefined;
  let knightRoom: Room | undefined;
  const professionRooms: Room[] = [];
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [playerId]: {
        id: playerId, name: 'Race Gear Tester', race: 'Кот', profession: 'Воин', level: 30,
        gold: 500, inventory: JSON.stringify(['dog_oathaxe', 'cat_silversilk']),
        equipment: JSON.stringify({ weapon: '', armor: '', helmet: '', gloves: '', boots: '', cloak: '', amulet: '' }),
        quests: '{}',
      },
      runtime_bird_assassin_01: {
        id: 'runtime_bird_assassin_01', name: 'Bird Assassin Tester', race: 'Птица', profession: '',
        city: 'Высокое гнездо', level: 30, gold: 500000, inventory: '[]',
        equipment: JSON.stringify({ weapon: '', armor: '', helmet: '', gloves: '', boots: '', cloak: '', amulet: '' }),
        quests: '{}',
      },
      runtime_knight_legacy_01: {
        id: 'runtime_knight_legacy_01', name: 'Legacy Knight Tester', race: 'Собака', profession: 'Воин',
        level: 30, gold: 500, inventory: JSON.stringify(['dog_oathaxe']),
        guildSkills: JSON.stringify({ professionUnlocked: ['shield_wall'], prof_shield_wall: 12345 }),
        equipment: JSON.stringify({ weapon: '', armor: '', helmet: '', gloves: '', boots: '', cloak: '', amulet: '' }),
        quests: '{}',
      },
      ...Object.fromEntries(professionRuntimeProfiles.map(profile => [profile.playerId, {
        id: profile.playerId, name: profile.profession + ' Runtime Tester', race: profile.race,
        profession: '', level: 30, gold: 100000, inventory: '[]',
        equipment: JSON.stringify({ weapon: '', armor: '', helmet: '', gloves: '', boots: '', cloak: '', amulet: '' }),
        quests: '{}',
      }])),
    }, null, 2));

    seedGuestCredentials(dataDir);


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

    room.send('equipItem', { id: 'dog_oathaxe' });
    await waitFor(() => notices.find(message => message === 'Этот предмет доступен только расе «Собака».'), 'cross-race equipment rejection');
    const afterRejected = readJson(join(dataDir, 'players.json'))[playerId];
    assert.equal(JSON.parse(afterRejected.equipment).weapon, '');
    assert.ok(JSON.parse(afterRejected.inventory).includes('dog_oathaxe'));

    room.send('equipItem', { id: 'cat_silversilk' });
    await waitFor(() => notices.find(message => message.includes('Экипировано: Мантия серебряного архива')), 'own-race equipment remains usable');
    const afterAllowed = readJson(join(dataDir, 'players.json'))[playerId];
    assert.equal(JSON.parse(afterAllowed.equipment).armor, 'cat_silversilk');
    const knightPlayerId = 'runtime_knight_legacy_01';
    const knightClient = new Client(`ws://127.0.0.1:${port}`);
    const knightToken = await guestToken(port, knightPlayerId);
    knightRoom = await knightClient.joinOrCreate('my_room', { playerId: knightPlayerId, sessionToken: knightToken });
    const knightNotices: string[] = [];
    knightRoom.onMessage('notice', payload => knightNotices.push(String(payload?.text || '')));
    knightRoom.send('equipItem', { id: 'dog_oathaxe' });
    await waitFor(() => knightNotices.find(message => message.includes('Экипировано: Топор клятвы')), 'legacy Warrior gear remains usable by migrated Knight');
    const knightSaved = readJson(join(dataDir, 'players.json'))[knightPlayerId];
    assert.equal(knightSaved.profession, 'Рыцарь');
    assert.equal(JSON.parse(knightSaved.equipment).weapon, 'dog_oathaxe');
    assert.deepEqual(JSON.parse(knightSaved.guildSkills).professionUnlocked, ['shield_wall']);
    assert.equal(JSON.parse(knightSaved.guildSkills).prof_shield_wall, 12345);
    const birdPlayerId = 'runtime_bird_assassin_01';
    const birdClient = new Client(`ws://127.0.0.1:${port}`);
    const birdToken = await guestToken(port, birdPlayerId);
    birdRoom = await birdClient.joinOrCreate('my_room', { playerId: birdPlayerId, sessionToken: birdToken });
    const birdNotices: string[] = [];
    let birdCatalog: any;
    birdRoom.onMessage('notice', payload => birdNotices.push(String(payload?.text || '')));
    birdRoom.onMessage('catalog', payload => { birdCatalog = payload; });

    birdRoom.send('chooseProfession', { profession: 'Ассасин птицы' });
    await waitFor(() => birdNotices.find(message => message.includes('Ты вступил в боевую гильдию: Ассасин птицы.')), 'Bird Assassin profession selection');
    await waitFor(() => birdCatalog?.professionSkills?.['Ассасин птицы']?.length === 2, 'Bird Assassin skill catalog');
    const birdNoticeCountBeforePurchase = birdNotices.length;
    birdRoom.send('buyItem', { id: 'WPN-BIRD-ASS-025' });
    const birdPurchaseResponse = await waitFor(
      () => birdNotices.length > birdNoticeCountBeforePurchase ? birdNotices[birdNotices.length - 1] : undefined,
      'Bird Assassin purchase response',
    );
    assert.ok(
      birdPurchaseResponse.includes('Куплено: Кинжал ветреной тени'),
      'Bird Assassin purchase was rejected: ' + birdPurchaseResponse,
    );
    birdRoom.send('equipItem', { id: 'WPN-BIRD-ASS-025' });
    await waitFor(() => birdNotices.find(message => message.includes('Экипировано: Кинжал ветреной тени')), 'Bird Assassin single dagger equip');
    const birdSaved = readJson(join(dataDir, 'players.json'))[birdPlayerId];
    assert.equal(birdSaved.profession, 'Ассасин птицы');
    assert.equal(JSON.parse(birdSaved.equipment).weapon, 'WPN-BIRD-ASS-025');

    // Exercise the actual server selection, shop and equipment handlers for every live profile.
    for (const profile of professionRuntimeProfiles) {
      const profileClient = new Client(`ws://127.0.0.1:${port}`);
      const profileToken = await guestToken(port, profile.playerId);
      const profileRoom = await profileClient.joinOrCreate('my_room', { playerId: profile.playerId, sessionToken: profileToken });
      professionRooms.push(profileRoom);
      const profileNotices: string[] = [];
      let profileCatalog: any;
      profileRoom.onMessage('notice', payload => profileNotices.push(String(payload?.text || '')));
      profileRoom.onMessage('catalog', payload => { profileCatalog = payload; });

      profileRoom.send('chooseProfession', { profession: profile.profession });
      await waitFor(
        () => profileNotices.find(message => message.includes(`Ты вступил в боевую гильдию: ${profile.profession}.`)),
        profile.profession + ' profession selection',
      );
      await waitFor(
        () => Array.isArray(profileCatalog?.professionSkills?.[profile.profession])
          && profileCatalog.professionSkills[profile.profession].length > 0 ? true : undefined,
        profile.profession + ' skill catalog',
      );
      profileRoom.send('buyItem', { id: profile.weaponId });
      await waitFor(
        () => profileNotices.find(message => message.startsWith('Куплено:')),
        profile.profession + ' weapon purchase',
      );
      profileRoom.send('equipItem', { id: profile.weaponId });
      await waitFor(
        () => profileNotices.find(message => message.includes('Экипировано: ' + profile.weaponName)),
        profile.profession + ' weapon equip',
      );

      const saved = readJson(join(dataDir, 'players.json'))[profile.playerId];
      assert.equal(saved.profession, profile.profession, profile.profession + ' profession must persist');
      assert.equal(JSON.parse(saved.equipment).weapon, profile.weaponId, profile.profession + ' weapon must persist');
    }
  } finally {
    for (const profileRoom of professionRooms) await leaveRoomSafely(profileRoom);
    await leaveRoomSafely(knightRoom);
    await leaveRoomSafely(birdRoom);
    await leaveRoomSafely(room);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
