import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

// Required files reflect the repository's actual, top-level documentation layout.
// Do not require a generated docs/ tree: project history and current Stage 28
// instructions are maintained in the existing README and stage notes.
const required = [
  'README.md',
  'README_STAGE28_CORRECTIVE_UPDATE_1.md',
  'CHANGELOG_STAGE28.md',
  'STAGE27_NOTES.md',
  'client/package.json',
  'client/package-lock.json',
  'client/tsconfig.json',
  'client/index.html',
  'client/src/main.ts',
  'client/scripts/verify-project.mjs',
  'client/scripts/audit-assets.mjs',
  'client/public/assets/asset-manifest.json',
  'server/package.json',
  'server/package-lock.json',
  'server/tsconfig.json',
  'server/src/index.ts',
  'server/src/PlayerSchema.ts',
  'VERIFY_PROJECT.bat',
  'Запустить игру.bat',
  'Остановить игру.bat',
  'tools/Start-Game.ps1',
  'tools/Stop-Game.ps1',
  'tools/Check-Game.ps1',
  '.github/workflows/quality.yml',
];

for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) {
    errors.push(`Missing required project file: ${rel}`);
  }
}

let jsonCount = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      jsonCount++;
      try { JSON.parse(fs.readFileSync(full, 'utf8')); }
      catch (e) { errors.push(`Invalid JSON ${path.relative(root, full)}: ${e.message}`); }
    }
  }
}
walk(root);

for (const rel of ['client/package-lock.json', 'server/package-lock.json']) {
  const lockPath = path.join(root, rel);
  if (!fs.existsSync(lockPath)) continue;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (lock.lockfileVersion !== 3) warnings.push(`${rel}: lockfileVersion is ${lock.lockfileVersion}; npm ci will validate compatibility.`);
    if (!lock.packages || !lock.packages['']) errors.push(`${rel}: missing root package metadata.`);
  } catch { /* JSON parse error already reported above. */ }
}

const forbidden = ['.env', '.env.local', '.env.production'];
for (const rel of forbidden) {
  if (fs.existsSync(path.join(root, rel))) {
    errors.push(`Potential secret-bearing file must not be committed: ${rel}`);
  }
}

console.log(`Misty Isles QA audit: ${jsonCount} JSON files parsed.`);
console.log(`Required files checked: ${required.length}.`);
console.log(`Errors: ${errors.length}; warnings: ${warnings.length}.`);
for (const warning of warnings) console.warn(`WARN: ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exit(1);
