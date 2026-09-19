// Checks on the assembled site. Run via `make test-build`, which builds first.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'dist');
const games = JSON.parse(readFileSync(join(root, 'games.json'), 'utf8'));

test('landing page is at the root and links every game', () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  assert.ok(!html.includes('<!-- POSTERS -->'), 'marker was not replaced');
  for (const g of games) assert.ok(html.includes(`href="${g.slug}/"`), `no link to ${g.slug}`);
  for (const file of ['style.css', '404.html', '.nojekyll']) assert.ok(existsSync(join(dist, file)), file);
});

for (const g of games) {
  test(`${g.slug} is published at /${g.slug}/`, () => {
    const dir = join(dist, g.slug);
    assert.ok(existsSync(join(dir, 'index.html')), 'no index.html');
    for (const leaked of ['.git', '.github', 'node_modules', 'test', 'tests', 'package.json', 'Makefile']) {
      assert.ok(!existsSync(join(dir, leaked)), `${leaked} should not be published`);
    }
  });

  // A game built for a different base path loads a blank page: every local
  // script/stylesheet the game's index.html points at must exist in dist.
  test(`${g.slug} index.html only references files that exist under the site root`, () => {
    const html = readFileSync(join(dist, g.slug, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((ref) => !/^(https?:|data:|\/\/)/.test(ref));
    assert.ok(refs.length > 0, 'expected at least one local script or stylesheet');
    for (const ref of refs) {
      const clean = ref.split(/[?#]/)[0];
      const file = clean.startsWith('/') ? join(dist, clean) : join(dist, g.slug, clean);
      assert.ok(existsSync(file), `${ref} -> ${file} does not exist`);
    }
  });
}

test('versions.json records a commit for every game', () => {
  const versions = JSON.parse(readFileSync(join(dist, 'versions.json'), 'utf8'));
  assert.deepEqual(Object.keys(versions).sort(), games.map((g) => g.slug).sort());
  for (const sha of Object.values(versions)) assert.match(sha, /^[0-9a-f]{40}$/);
});

test('nothing unexpected at the site root', () => {
  const expected = new Set(['index.html', '404.html', 'style.css', 'art', '.nojekyll', 'versions.json',
    ...games.map((g) => g.slug)]);
  for (const name of readdirSync(dist)) assert.ok(expected.has(name), `unexpected ${name} in dist/`);
});

// Regression: a landing-only build used to wipe dist/, deleting every built game.
test('a landing-only build keeps the games already in dist/', async () => {
  const { execSync } = await import('node:child_process');
  execSync('node scripts/build.mjs --landing-only', { cwd: root, stdio: 'ignore' });
  for (const g of games) assert.ok(existsSync(join(dist, g.slug, 'index.html')), `${g.slug} was deleted`);
  assert.ok(existsSync(join(dist, 'versions.json')));
});
