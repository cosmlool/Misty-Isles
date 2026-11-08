import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('public');
const manifestPath = path.join(root, 'assets', 'asset-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const groups = ['items', 'locations', 'characters', 'illustrations'];
let errors = 0, checked = 0;
for (const group of groups) {
  const seen = new Set();
  for (const asset of manifest[group] ?? []) {
    checked++;
    if (!asset.id || !asset.path || seen.has(asset.id)) { console.error(`INVALID/DUPLICATE ${group}: ${asset.id ?? '(no id)'}`); errors++; continue; }
    seen.add(asset.id);
    const relative = asset.path.replace(/^\//, '');
    const diskPath = path.resolve(root, relative);
    if (!diskPath.startsWith(root + path.sep)) { console.error(`UNSAFE PATH ${group}: ${asset.id}`); errors++; continue; }
    if (!fs.existsSync(diskPath)) { console.error(`MISSING ${group}: ${asset.id} -> ${asset.path}`); errors++; continue; }
    const data = fs.readFileSync(diskPath);
    if (!data.length) { console.error(`EMPTY ${group}: ${asset.id}`); errors++; continue; }
    if (diskPath.endsWith('.svg') && !data.toString('utf8').includes('<svg')) { console.error(`INVALID SVG ${asset.id}`); errors++; }
    if (/\.(webp|png|jpe?g)$/i.test(diskPath) && data.length < 16) { console.error(`INVALID IMAGE ${asset.id}`); errors++; }
  }
}
console.log(`Asset audit: ${checked} entries checked across ${groups.length} groups.`);
if (errors) process.exit(1);
console.log('All manifest files exist, are non-empty, and passed basic format checks.');
