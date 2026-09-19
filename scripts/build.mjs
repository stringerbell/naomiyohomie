// Assembles the whole site into dist/:
//   dist/            <- landing page (landing/, with posters rendered from games.json)
//   dist/<slug>/     <- each game, built from its own repo
//
// Where a game's source comes from:
//   - default: the sibling checkout ../<slug> if it exists (so you can preview
//     local, uncommitted work), otherwise a fresh clone from GitHub
//   - GAMES_SOURCE=remote: always a fresh clone (what CI uses)
//
// Flags: --landing-only skips the games (fast, for working on the landing page).

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderLanding, shouldCopyStatic, validateGames } from './lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const cache = join(root, '.cache', 'games');
const landingOnly = process.argv.includes('--landing-only');
const forceRemote = process.env.GAMES_SOURCE === 'remote';

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
const capture = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8' }).trim();

function sourceFor(game) {
  const sibling = resolve(root, '..', game.slug);
  if (!forceRemote && existsSync(join(sibling, '.git'))) {
    console.log(`  using local checkout ${sibling}`);
    return sibling;
  }
  const dir = join(cache, game.slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  run(`git clone --depth 1 https://github.com/${game.repo}.git ${JSON.stringify(dir)}`, root);
  return dir;
}

function buildGame(game) {
  console.log(`\n== ${game.title} (${game.slug})`);
  const src = sourceFor(game);
  const dest = join(dist, game.slug);

  if (game.build) {
    // Leave an existing local node_modules alone; clones always need an install.
    if (!existsSync(join(src, 'node_modules'))) run('npm ci', src);
    run(game.build, src);
    cpSync(join(src, game.out), dest, { recursive: true });
  } else {
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(src).filter(shouldCopyStatic)) {
      cpSync(join(src, name), join(dest, name), { recursive: true });
    }
  }

  if (!existsSync(join(dest, 'index.html'))) {
    throw new Error(`${game.slug}: no index.html ended up in ${dest}`);
  }
  return capture('git rev-parse HEAD', src);
}

const games = validateGames(JSON.parse(readFileSync(join(root, 'games.json'), 'utf8')));

for (const game of games) {
  if (!existsSync(join(root, 'landing', 'art', `${game.slug}.svg`))) {
    throw new Error(`${game.slug}: add poster art at landing/art/${game.slug}.svg`);
  }
}

// A landing-only build refreshes the landing files in place and keeps any games
// already built into dist/.
if (!landingOnly) rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'landing'), dist, { recursive: true });
const template = readFileSync(join(root, 'landing', 'index.html'), 'utf8');
writeFileSync(join(dist, 'index.html'), renderLanding(template, games));
// No Jekyll processing on GitHub Pages (it would drop files starting with "_").
writeFileSync(join(dist, '.nojekyll'), '');

if (!landingOnly) {
  const versions = {};
  for (const game of games) versions[game.slug] = buildGame(game);
  writeFileSync(join(dist, 'versions.json'), JSON.stringify(versions, null, 2) + '\n');
}

console.log(`\nSite assembled in ${dist}`);
