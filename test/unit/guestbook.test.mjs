import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatDate, resolveConfig } from '../../landing/guestbook.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the guestbook stays hidden until it has an API and a Turnstile key', () => {
  assert.equal(resolveConfig('naomiyohomie.com', { api: 'https://comments.naomiyohomie.com', sitekey: '' }), null);
  assert.equal(resolveConfig('naomiyohomie.com', { api: '', sitekey: '0xKEY' }), null);
  assert.equal(resolveConfig('naomiyohomie.com', {}), null);
});

test('the live site only talks to an https API', () => {
  assert.equal(resolveConfig('naomiyohomie.com', { api: 'http://comments.naomiyohomie.com', sitekey: '0xKEY' }), null);
  assert.deepEqual(resolveConfig('naomiyohomie.com', { api: 'https://comments.naomiyohomie.com/', sitekey: '0xKEY' }),
    { api: 'https://comments.naomiyohomie.com', sitekey: '0xKEY' });
});

test('local previews use the local Worker and the Turnstile test key', () => {
  const config = resolveConfig('localhost', { api: 'https://comments.naomiyohomie.com', sitekey: '' });
  assert.equal(config.api, 'http://localhost:8787');
  assert.match(config.sitekey, /^1x0+AA$/);
});

test('formatDate turns the API timestamp into a readable day', () => {
  assert.equal(formatDate(Date.UTC(2026, 8, 19, 12) / 1000, 'en-US'), 'September 19, 2026');
});

// Comment text comes from strangers. It must only ever be placed with textContent.
test('guestbook.js never builds HTML from strings', () => {
  const source = readFileSync(join(root, 'landing', 'guestbook.js'), 'utf8');
  for (const risky of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
    assert.ok(!source.includes(risky), `guestbook.js uses ${risky}`);
  }
});

test('the landing page has the hooks guestbook.js looks for', () => {
  const html = readFileSync(join(root, 'landing', 'index.html'), 'utf8');
  for (const hook of ['id="guestbook"', 'data-api=', 'data-sitekey=', 'data-notes', 'data-notes-status',
    'data-form-status', 'data-turnstile', 'name="name"', 'name="message"', 'name="website"', 'src="guestbook.js"']) {
    assert.ok(html.includes(hook), `missing ${hook}`);
  }
});
