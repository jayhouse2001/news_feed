// VERSION is the single source of truth; the browser cannot read a bare file
// at the repo root, so the value is written into a script the page loads and
// into the manifest. Run this after editing VERSION.
import { readFile, writeFile } from 'node:fs/promises';

const version = (await readFile('VERSION', 'utf8')).trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`VERSION must be major.minor.revision, got "${version}"`);
}

await writeFile(
  'site/js/version.js',
  `// Generated from VERSION by scripts/sync-version.mjs — do not edit.\n`
  + `const APP_VERSION = '${version}';\n`,
  'utf8'
);

const manifestPath = 'site/manifest.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.version = version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`version ${version} written to site/js/version.js and ${manifestPath}`);
