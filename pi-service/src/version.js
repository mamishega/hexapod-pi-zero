// Which software version is running: the VERSION file written by tools/deploy.sh (commit and date),
// or the package version when running from a development copy.
import fs from 'node:fs';
import path from 'node:path';

export function readVersion(root, fsModule = fs) {
  try {
    const text = fsModule.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
    if (text) return text.split('\n')[0].slice(0, 80);
  } catch {}
  try { return `${JSON.parse(fsModule.readFileSync(path.join(root, 'package.json'), 'utf8')).version} (development copy)`; } catch { return 'unknown'; }
}
