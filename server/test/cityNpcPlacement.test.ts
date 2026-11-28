import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cityNpcs = JSON.parse(readFileSync(resolve(serverDir, 'data/city_npcs.json'), 'utf8'));

test('the unique blacksmith Brum Iron Moustache is located in Silver Ruins', () => {
  const blacksmiths = cityNpcs.filter((npc: any) => npc.role === 'Кузнец');
  assert.equal(blacksmiths.length, 1);
  assert.equal(blacksmiths[0].id, 'npc_dog_smith');
  assert.equal(blacksmiths[0].name, 'Брум Железный Ус');
  assert.equal(blacksmiths[0].city, 'Серебряные руины');
});
