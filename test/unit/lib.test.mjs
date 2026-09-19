import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  POSTERS_MARKER, changedGames, escapeHtml, renderLanding, renderPoster, shouldCopyStatic, validateGames,
} from '../../scripts/lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const game = (overrides = {}) => ({
  slug: 'zoo-problems',
  repo: 'stringerbell/zoo-problems',
  title: 'Zoo Problems',
  blurb: 'You are a giraffe.',
  kind: 'Sneaky comedy',
  colors: { bg: '#FFC93C', ink: '#3A2208', accent: '#C8641B' },
  ...overrides,
});

test('the real games.json is valid', () => {
  const games = JSON.parse(readFileSync(join(root, 'games.json'), 'utf8'));
  assert.doesNotThrow(() => validateGames(games));
});

test('every game in games.json has poster art', () => {
  const games = JSON.parse(readFileSync(join(root, 'games.json'), 'utf8'));
  for (const g of games) {
    assert.ok(existsSync(join(root, 'landing', 'art', `${g.slug}.svg`)), `missing art for ${g.slug}`);
  }
});

test('validateGames rejects an empty list', () => {
  assert.throws(() => validateGames([]), /non-empty/);
  assert.throws(() => validateGames({}), /non-empty/);
});

test('validateGames rejects bad slugs, since the slug becomes the URL path', () => {
  for (const slug of ['Zoo', 'zoo problems', '../etc', 'zoo/', '', '-zoo']) {
    assert.throws(() => validateGames([game({ slug })]), /slug/, `accepted ${JSON.stringify(slug)}`);
  }
});

test('validateGames rejects slugs that would overwrite landing page files', () => {
  assert.throws(() => validateGames([game({ slug: 'art' })]), /reserved/);
});

test('validateGames rejects duplicate slugs', () => {
  assert.throws(() => validateGames([game(), game()]), /duplicate/);
});

test('validateGames rejects a repo that is not owner/name', () => {
  assert.throws(() => validateGames([game({ repo: 'https://github.com/a/b' })]), /repo/);
  assert.throws(() => validateGames([game({ repo: 'a/b; rm -rf /' })]), /repo/);
});

test('validateGames needs build and out together', () => {
  assert.throws(() => validateGames([game({ build: 'npm run build' })]), /build and out/);
  assert.throws(() => validateGames([game({ out: 'dist' })]), /build and out/);
  assert.doesNotThrow(() => validateGames([game({ build: 'npm run build', out: 'dist' })]));
});

test('validateGames needs text and colours for the poster', () => {
  assert.throws(() => validateGames([game({ title: ' ' })]), /title/);
  assert.throws(() => validateGames([game({ blurb: undefined })]), /blurb/);
  assert.throws(() => validateGames([game({ colors: { bg: 'red', ink: '#000000', accent: '#ffffff' } })]), /colors\.bg/);
  assert.throws(() => validateGames([game({ colors: undefined })]), /colors/);
});

test('shouldCopyStatic publishes game files but not repo plumbing', () => {
  for (const name of ['index.html', 'style.css', 'styles.css', 'src', 'assets', 'vendor', 'levels']) {
    assert.equal(shouldCopyStatic(name), true, name);
  }
  for (const name of ['.git', '.github', '.gitignore', '.DS_Store', '.nojekyll', 'node_modules', 'test',
    'tests', 'Makefile', 'package.json', 'package-lock.json', 'README.md', 'GAME_DESIGN.md', 'CNAME']) {
    assert.equal(shouldCopyStatic(name), false, name);
  }
});

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml(`<b a="1">Tom & 'Jerry'</b>`), '&lt;b a=&quot;1&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/b&gt;');
});

test('renderPoster links to the game with a relative, trailing-slash URL', () => {
  const html = renderPoster(game());
  assert.match(html, /href="zoo-problems\/"/);
  assert.match(html, /src="art\/zoo-problems\.svg"/);
  assert.match(html, /--bg:#FFC93C;--ink:#3A2208;--accent:#C8641B/);
  assert.match(html, /Play Zoo Problems/);
});

test('renderPoster escapes text from games.json', () => {
  const html = renderPoster(game({ title: 'Cats & <Dogs>', blurb: '"quoted"' }));
  assert.ok(!html.includes('<Dogs>'));
  assert.match(html, /Cats &amp; &lt;Dogs&gt;/);
  assert.match(html, /&quot;quoted&quot;/);
});

test('renderLanding puts one poster per game where the marker was', () => {
  const html = renderLanding(`<ul>${POSTERS_MARKER}</ul>`, [game(), game({ slug: 'dog-salon', title: 'Salon Teckel' })]);
  assert.ok(!html.includes(POSTERS_MARKER));
  assert.equal(html.match(/class="poster"/g).length, 2);
  assert.ok(html.indexOf('zoo-problems/') < html.indexOf('dog-salon/'), 'keeps games.json order');
});

test('renderLanding fails loudly if the template lost its marker', () => {
  assert.throws(() => renderLanding('<ul></ul>', [game()]), /marker/);
});

test('the real landing template still has the posters marker', () => {
  assert.ok(readFileSync(join(root, 'landing', 'index.html'), 'utf8').includes(POSTERS_MARKER));
});

test('changedGames reports only the games whose commit moved', () => {
  assert.deepEqual(changedGames({ a: '1', b: '2' }, { a: '1', b: '2' }), []);
  assert.deepEqual(changedGames({ a: '1', b: '2' }, { a: '1', b: '3' }), ['b']);
});

test('changedGames treats a new game, or no live site yet, as changed', () => {
  assert.deepEqual(changedGames({ a: '1' }, { a: '1', c: '9' }), ['c']);
  assert.deepEqual(changedGames(null, { a: '1', b: '2' }), ['a', 'b']);
});
