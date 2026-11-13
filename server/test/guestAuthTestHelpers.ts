import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function testGuestProof(playerId: string): string {
  return `test-guest-proof-${createHash('sha256').update(playerId).digest('hex')}`;
}

export function seedGuestCredentials(dataDir: string, additionalPlayerIds: string[] = []): void {
  const playersPath = join(dataDir, 'players.json');
  const players = existsSync(playersPath) ? JSON.parse(readFileSync(playersPath, 'utf8')) : {};
  const playerIds = new Set([...Object.keys(players), ...additionalPlayerIds]);
  const credentials = Array.from(playerIds, playerId => ({
    playerId,
    tokenHash: createHash('sha256').update(testGuestProof(playerId)).digest('hex'),
    createdAt: Date.now(),
  }));
  writeFileSync(join(dataDir, 'guest_credentials.json'), JSON.stringify(credentials, null, 2));
}


/** Best-effort test cleanup: never let a stalled client leave block the serial server test suite. */
export async function leaveRoomSafely(room: { leave: () => Promise<unknown> } | undefined, timeoutMs = 1_000): Promise<void> {
  if (!room) return;
  await Promise.race([
    room.leave().then(() => undefined).catch(() => undefined),
    delay(timeoutMs),
  ]);
}
