// Used by the scheduled CI run: has any game repo moved on from what is live?
// Prints the changed slugs and, when running in GitHub Actions, sets the
// `changed` output to true/false so the workflow can skip pointless deploys.

import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedGames, validateGames } from './lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteUrl = process.env.SITE_URL ?? 'https://naomiyohomie.com';
const games = validateGames(JSON.parse(readFileSync(join(root, 'games.json'), 'utf8')));

let deployed = null;
try {
  const res = await fetch(`${siteUrl}/versions.json`, { cache: 'no-store' });
  if (res.ok) deployed = await res.json();
} catch {
  // Site not reachable yet: treat everything as changed.
}

const current = {};
for (const game of games) {
  const out = execSync(`git ls-remote https://github.com/${game.repo}.git HEAD`, { encoding: 'utf8' });
  current[game.slug] = out.split(/\s+/)[0];
}

const changed = changedGames(deployed, current);
console.log(changed.length ? `Changed: ${changed.join(', ')}` : 'Nothing changed since the last deploy.');
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.length > 0}\n`);
}
