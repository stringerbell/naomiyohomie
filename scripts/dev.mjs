// `make serve`: preview the site, rebuild the landing page when its files
// change, and refresh the browser.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevServer } from './dev-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const port = Number(process.env.PORT ?? 8090);

const build = (...flags) => spawnSync(process.execPath, [join(root, 'scripts', 'build.mjs'), ...flags], {
  cwd: root, stdio: flags.includes('--landing-only') ? ['ignore', 'ignore', 'inherit'] : 'inherit',
}).status === 0;

// Games take a while to build, so only do it when one is missing from dist/.
const games = JSON.parse(readFileSync(join(root, 'games.json'), 'utf8'));
const gamesBuilt = games.every((g) => existsSync(join(dist, g.slug, 'index.html')));
if (!build(...(gamesBuilt ? ['--landing-only'] : []))) process.exit(1);
if (gamesBuilt) console.log('Using the games already in dist/ (run `make build` to rebuild them).');

const dev = createDevServer({ root: dist });
dev.server.listen(port, () => {
  console.log(`\nnaomiyohomie.com preview - http://localhost:${port}`);
  console.log('Watching landing/ and games.json. Save a file and the browser refreshes.\n');
});

let timer;
const changed = (what) => {
  // Editors fire several events per save; wait for them to settle.
  clearTimeout(timer);
  timer = setTimeout(() => {
    const ok = build('--landing-only');
    console.log(`${new Date().toLocaleTimeString()}  ${what} changed - ${ok ? 'rebuilt, refreshing' : 'BUILD FAILED (fix it and save again)'}`);
    if (ok) dev.reload();
  }, 80);
};

watch(join(root, 'landing'), { recursive: true }, (_event, file) => changed(`landing/${file ?? ''}`));
watch(join(root, 'games.json'), () => changed('games.json'));
