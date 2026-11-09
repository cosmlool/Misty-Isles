import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const e2eDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(e2eDir, '..');
const serverDir = join(projectRoot, 'server');
const dataDir = mkdtempSync(join(tmpdir(), 'misty-isles-playwright-'));
const staticFiles = [
  'equipment_catalog.json',
  'forgotten_lands.json',
  'city_npcs.json'
];

for (const file of staticFiles) {
  cpSync(join(serverDir, 'data', file), join(dataDir, file));
}

const child = spawn(
  process.execPath,
  ['--import', 'tsx', 'src/index.ts'],
  {
    cwd: serverDir,
    env: {
      ...process.env,
      MISTY_DATA_DIR: dataDir,
      MISTY_PORT: process.env.MISTY_PORT || '2567'
    },
    stdio: 'inherit'
  }
);

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  rmSync(dataDir, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('error', (error) => {
  console.error('Could not start the isolated Misty Isles server:', error);
  cleanup();
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  cleanup();
  process.exitCode = code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1);
});
