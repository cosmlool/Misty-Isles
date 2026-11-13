import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const npxCommand = isWindows ? 'npx.cmd' : 'npx';
const startedAt = Date.now();
let completed = 0;

function run(command, args, cwd, label) {
  console.log(`\n=== [${completed + 1}] ${label} ===`);
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: isWindows,
    env: process.env
  });
  if (result.error) {
    console.error(`Could not start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nFAILED: ${label} (exit code ${result.status ?? 'unknown'}).`);
    console.error('Fix the first reported error, then run VERIFY_PROJECT.bat again.');
    process.exit(result.status || 1);
  }
  completed++;
  console.log(`PASSED: ${label}`);
}

function ensureDependencies(folder, label) {
  const projectDir = resolve(root, folder);
  if (existsSync(resolve(projectDir, 'node_modules'))) {
    console.log(`Dependencies ready: ${label}`);
    return;
  }
  if (!existsSync(resolve(projectDir, 'package-lock.json'))) {
    console.error(`Missing required package-lock.json for ${label}; refusing a non-reproducible install.`);
    process.exit(1);
  }
  run(npmCommand, ['ci', '--no-audit', '--no-fund'], projectDir, `Install locked ${label} dependencies`);
}

if (process.versions.node.split('.')[0] !== '22') {
  console.error(`Misty Isles verification uses Node.js 22 (CI version). Current version: ${process.versions.node}`);
  process.exit(1);
}

run(process.execPath, ['tools/qa-audit.mjs'], root, 'Project files, JSON and data audit');

ensureDependencies('client', 'client');
ensureDependencies('server', 'server');
ensureDependencies('e2e', 'Playwright');

run(npmCommand, ['run', 'verify:project'], resolve(root, 'client'), 'Client checks, assets and production build');
run(npmCommand, ['test'], resolve(root, 'server'), 'Complete server test suite');
run(npmCommand, ['run', 'build'], resolve(root, 'server'), 'Server TypeScript build');
run(npxCommand, ['playwright', 'install', 'chrome'], resolve(root, 'e2e'), 'Playwright Chrome installation/check');
run(npmCommand, ['test'], resolve(root, 'e2e'), 'Playwright browser scenarios');

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\nALL CHECKS PASSED: ${completed} steps in ${seconds}s.`);
console.log('No game balance or player-save data was changed by this verification command.');
