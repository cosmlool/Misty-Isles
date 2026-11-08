import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pub = path.join(root, 'public');
const manifestPath = path.join(pub, 'assets', 'asset-manifest.json');
const errors = [];
const warnings = [];
if (!fs.existsSync(manifestPath)) errors.push('Missing public/assets/asset-manifest.json');
else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const paths = new Map();
  for (const group of Object.keys(manifest)) {
    if (!Array.isArray(manifest[group])) continue;
    for (const item of manifest[group]) {
      if (!item?.path) continue;
      const rel = item.path.replace(/^\//, '');
      const abs = path.resolve(pub, rel);
      if (!abs.startsWith(pub + path.sep)) { errors.push(`Path escapes public directory: ${item.path}`); continue; }
      if (!fs.existsSync(abs)) errors.push(`Missing asset: ${item.path}`);
      const prior = paths.get(item.path);
      if (prior && prior !== item.id) warnings.push(`Shared asset path ${item.path} used by ${prior} and ${item.id}`);
      else paths.set(item.path, item.id || item.path);
    }
  }
  console.log(`Manifest groups checked: ${Object.keys(manifest).length}; unique paths: ${paths.size}`);
}
const html = path.join(root, 'index.html');
if (!fs.existsSync(html)) errors.push('Missing client/index.html');
else {
  const s = fs.readFileSync(html, 'utf8');
  for (const token of ['archipelago-map.webp','character-mage.webp','equipment-catalog.webp','creature-catalog.webp']) {
    if (!s.includes(token) && !fs.readFileSync(path.join(root,'src','main.ts'),'utf8').includes(token)) warnings.push(`Expected visual asset not referenced: ${token}`);
  }
  if (/background-size\s*:\s*100%\s+100%/i.test(s)) warnings.push('Legacy forced 100% 100% background sizing still exists; verify final cascade before release.');
  if (!s.includes('stage15-single-source-layout')) errors.push('Stage 15 authoritative layout style is missing.');
}
console.log(`Errors: ${errors.length}; warnings: ${warnings.length}`);
for (const w of warnings) console.warn(`WARN: ${w}`);
for (const e of errors) console.error(`ERROR: ${e}`);
if (errors.length) process.exit(1);
