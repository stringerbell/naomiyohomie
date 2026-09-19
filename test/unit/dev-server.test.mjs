import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { RELOAD_PATH, contentType, createDevServer, injectReload, resolveInside } from '../../scripts/dev-server.mjs';

test('injectReload adds the script just before </body>, or at the end without one', () => {
  assert.match(injectReload('<body><p>hi</p></body>'), /<p>hi<\/p><script>.*EventSource.*<\/script><\/body>$/);
  assert.match(injectReload('<p>fragment</p>'), /^<p>fragment<\/p><script>/);
});

test('resolveInside never leaves the served folder', () => {
  const root = '/srv/dist';
  assert.equal(resolveInside(root, '/'), '/srv/dist');
  assert.equal(resolveInside(root, '/zoo-problems/index.html'), '/srv/dist/zoo-problems/index.html');
  assert.equal(resolveInside(root, '/a/../style.css'), '/srv/dist/style.css');
  // Climbing out is clamped to the folder (like a browser normalises URLs), never resolved outside it.
  for (const climb of ['/../secret', '/..%2f..%2fetc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/a/../../x',
    '/../dist-other/x', '/..\\..\\x']) {
    const file = resolveInside(root, climb);
    assert.ok(file === root || file.startsWith(`${root}/`), `${climb} -> ${file}`);
  }
  assert.equal(resolveInside(root, '/../secret'), '/srv/dist/secret');
  for (const malformed of ['/%00', '/%E0%A4%A']) assert.equal(resolveInside(root, malformed), null, malformed);
});

test('contentType knows what games need', () => {
  assert.match(contentType('a/index.HTML'), /text\/html/);
  assert.match(contentType('main.js'), /javascript/);
  assert.equal(contentType('physics.wasm'), 'application/wasm');
  assert.equal(contentType('song.mp3'), 'audio/mpeg');
  assert.equal(contentType('mystery.bin'), 'application/octet-stream');
});

let dir, dev, base;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nyh-dev-'));
  writeFileSync(join(dir, 'index.html'), '<html><body>home</body></html>');
  writeFileSync(join(dir, '404.html'), '<html><body>lost</body></html>');
  writeFileSync(join(dir, 'style.css'), 'body{}');
  mkdirSync(join(dir, 'game'));
  writeFileSync(join(dir, 'game', 'index.html'), '<html><body>game</body></html>');
  writeFileSync(join(dir, '..', 'nyh-outside.txt'), 'outside');
  dev = createDevServer({ root: dir });
  await new Promise((done) => dev.server.listen(0, done));
  base = `http://localhost:${dev.server.address().port}`;
});

after(async () => {
  await dev.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(dir, '..', 'nyh-outside.txt'), { force: true });
});

test('serves pages with the reload script, without changing the file on disk', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(await res.text(), /home<script>.*EventSource/);
  assert.ok(!readFileSync(join(dir, 'index.html'), 'utf8').includes('EventSource'));
});

test('serves other files untouched', async () => {
  const res = await fetch(`${base}/style.css`);
  assert.match(res.headers.get('content-type'), /text\/css/);
  assert.equal(await res.text(), 'body{}');
});

test('folders work like GitHub Pages: redirect to the trailing slash, then index.html', async () => {
  const redirect = await fetch(`${base}/game?x=1`, { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/game/?x=1');
  assert.match(await (await fetch(`${base}/game/`)).text(), /game/);
});

test('missing pages get the 404 page, and paths outside the folder are not served', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /lost/);
  const escape = await fetch(`${base}/..%2fnyh-outside.txt`);
  assert.equal(escape.status, 404);
  assert.ok(!(await escape.text()).includes('outside'));
});

test('reload() tells every connected browser to refresh', async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}${RELOAD_PATH}`, { signal: controller.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  assert.match(await read(), /connected/);
  assert.equal(dev.clientCount(), 1);

  dev.reload();
  assert.match(await read(), /data: reload/);
  controller.abort();
});
