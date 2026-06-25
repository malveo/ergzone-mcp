// Sync the .mcpb manifest version with the release version (called from CI).
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('usage: set-manifest-version.mjs <version>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = version;
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest.json version ->', version);
