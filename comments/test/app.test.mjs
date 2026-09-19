import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GLOBAL_PER_HOUR, PER_IP_PER_HOUR, createApp } from '../src/app.js';
import { memoryStore } from './memory-store.mjs';

const ORIGIN = 'https://naomiyohomie.com';
const BASE = 'https://comments.naomiyohomie.com';

function setup({ turnstileOk = true, emailFails = false } = {}) {
  const store = memoryStore();
  const emails = [];
  const clock = { ms: Date.UTC(2026, 8, 19, 12, 0, 0) };
  const handle = createApp({
    store,
    now: () => clock.ms,
    verifyTurnstile: async (token) => turnstileOk && token === 'good-token',
    sendEmail: async (raw) => { if (emailFails) throw new Error('mail down'); emails.push(raw); },
    config: {
      modSecret: 'test-secret-test-secret-test-secret-1234',
      modEmail: 'mod@example.com',
      fromEmail: 'guestbook@naomiyohomie.com',
      publicUrl: BASE,
      allowedOrigins: [ORIGIN],
    },
  });

  const post = (body, { origin = ORIGIN, ip = '203.0.113.7' } = {}) => handle(new Request(`${BASE}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(origin ? { Origin: origin } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  const list = async () => (await (await handle(new Request(`${BASE}/comments?page=guestbook`))).json()).comments;
  const reviewUrl = () => {
    const body = Buffer.from(emails.at(-1).split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
    return body.match(/https:\/\/\S+\/moderate\?\S+/)[0];
  };
  const moderate = (fields) => handle(new Request(`${BASE}/moderate`, { method: 'POST', body: new URLSearchParams(fields) }));
  const linkFields = () => Object.fromEntries(new URL(reviewUrl()).searchParams);

  return { store, emails, clock, handle, post, list, reviewUrl, moderate, linkFields };
}

const comment = (over = {}) => ({
  page: 'guestbook', name: 'Sam', message: 'I love the giraffe game!', turnstileToken: 'good-token', ...over,
});

test('a new comment is quarantined: saved as pending, emailed, and not listed', async () => {
  const t = setup();
  const res = await t.post(comment());
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(t.store.rows.size, 1);
  assert.equal([...t.store.rows.values()][0].status, 'pending');
  assert.equal(t.emails.length, 1);
  assert.deepEqual(await t.list(), []);
});

test('a submitter cannot approve their own comment or plant a reply', async () => {
  const t = setup();
  await t.post(comment({ status: 'approved', reply: 'fake reply from Naomi', id: 'chosen-id' }));
  const row = [...t.store.rows.values()][0];
  assert.equal(row.status, 'pending');
  assert.equal(row.reply, '');
  assert.notEqual(row.id, 'chosen-id');
  assert.deepEqual(await t.list(), []);
});

test('opening the review link changes nothing (mail scanners open links)', async () => {
  const t = setup();
  await t.post(comment());
  const res = await t.handle(new Request(t.reviewUrl()));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Approve and put on the site/);
  assert.equal([...t.store.rows.values()][0].status, 'pending');
  assert.deepEqual(await t.list(), []);
});

test('approving publishes the comment, with Naomi\'s reply', async () => {
  const t = setup();
  await t.post(comment());
  const res = await t.moderate({ ...t.linkFields(), action: 'approve', reply: ' Thank you!! ' });
  assert.equal(res.status, 200);
  const [listed] = await t.list();
  assert.equal(listed.name, 'Sam');
  assert.equal(listed.message, 'I love the giraffe game!');
  assert.equal(listed.reply, 'Thank you!!');
  assert.deepEqual(Object.keys(listed).sort(), ['createdAt', 'id', 'message', 'name', 'reply'], 'no ip_hash or status leaks');
});

test('rejecting keeps it off the site, and an approved comment can be taken down later', async () => {
  const t = setup();
  await t.post(comment());
  await t.moderate({ ...t.linkFields(), action: 'reject' });
  assert.deepEqual(await t.list(), []);

  await t.moderate({ ...t.linkFields(), action: 'approve', reply: 'hi' });
  assert.equal((await t.list()).length, 1);
  await t.moderate({ ...t.linkFields(), action: 'reject', reply: 'hi' });
  assert.deepEqual(await t.list(), []);
  assert.equal([...t.store.rows.values()][0].reply, '', 'a hidden comment keeps no public reply');
});

test('moderation needs a valid signature, for the right comment, that has not expired', async () => {
  const t = setup();
  await t.post(comment());
  const link = t.linkFields();

  for (const bad of [{ ...link, sig: 'AAAA' }, { ...link, id: 'someone-else' }, { ...link, exp: String(Number(link.exp) + 1) },
    { id: link.id }, {}]) {
    const res = await t.moderate({ ...bad, action: 'approve' });
    assert.equal(res.status, 403, JSON.stringify(bad));
  }
  assert.equal((await t.handle(new Request(`${BASE}/moderate?id=${link.id}&exp=${link.exp}&sig=nope`))).status, 403);

  t.clock.ms += 181 * 24 * 3600 * 1000;
  assert.equal((await t.moderate({ ...link, action: 'approve' })).status, 403, 'expired');
  assert.deepEqual(await t.list(), []);
});

test('moderation ignores unknown actions and over-long replies', async () => {
  const t = setup();
  await t.post(comment());
  assert.equal((await t.moderate({ ...t.linkFields(), action: 'delete-everything' })).status, 400);
  assert.equal((await t.moderate({ ...t.linkFields(), action: 'approve', reply: 'x'.repeat(601) })).status, 422);
  assert.deepEqual(await t.list(), []);
});

test('the review page escapes comment text', async () => {
  const t = setup();
  await t.post(comment({ name: '<img src=x onerror=alert(1)>', message: '</blockquote><script>alert(1)</script>' }));
  const page = await (await t.handle(new Request(t.reviewUrl()))).text();
  assert.ok(!page.includes('<script>alert'));
  assert.ok(!page.includes('<img src=x'));
  assert.match(page, /&lt;script&gt;/);
});

test('the review page is locked down', async () => {
  const t = setup();
  await t.post(comment());
  const res = await t.handle(new Request(t.reviewUrl()));
  assert.match(res.headers.get('Content-Security-Policy'), /default-src 'none'/);
  assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer', 'the signed URL must not leak via Referer');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('bots that fill the hidden field get a fake success and nothing is stored', async () => {
  const t = setup();
  const res = await t.post(comment({ website: 'http://spam.example' }));
  assert.equal(res.status, 200);
  assert.equal(t.store.rows.size, 0);
  assert.equal(t.emails.length, 0);
});

test('a failed or missing Turnstile check stores nothing', async () => {
  const t = setup();
  assert.equal((await t.post(comment({ turnstileToken: 'forged' }))).status, 403);
  assert.equal((await t.post(comment({ turnstileToken: undefined }))).status, 403);
  assert.equal(t.store.rows.size, 0);
  assert.equal(t.emails.length, 0);
});

test('posts from other origins, or with no Origin, are refused', async () => {
  const t = setup();
  assert.equal((await t.post(comment(), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await t.post(comment(), { origin: null })).status, 403);
  assert.equal(t.store.rows.size, 0);
  const res = await t.handle(new Request(`${BASE}/comments?page=guestbook`, { headers: { Origin: 'https://evil.example' } }));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('invalid comments get a friendly 422 naming the field', async () => {
  const t = setup();
  const res = await t.post(comment({ message: 'check out www.spam.com' }));
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { error: "Messages can't have web links in them.", field: 'message' });
  assert.equal((await t.post('{not json')).status, 400);
  assert.equal((await t.post(comment({ message: 'x'.repeat(9000) }))).status, 413);
  assert.equal(t.store.rows.size, 0);
});

test('each visitor is rate limited per hour, and the limit resets', async () => {
  const t = setup();
  for (let i = 0; i < PER_IP_PER_HOUR; i++) assert.equal((await t.post(comment())).status, 201);
  assert.equal((await t.post(comment())).status, 429);
  assert.equal((await t.post(comment(), { ip: '198.51.100.1' })).status, 201, 'other visitors are unaffected');
  t.clock.ms += 3601 * 1000;
  assert.equal((await t.post(comment())).status, 201);
});

test('a flood from many addresses cannot bury the moderator in email', async () => {
  const t = setup();
  for (let i = 0; i < GLOBAL_PER_HOUR; i++) {
    assert.equal((await t.post(comment(), { ip: `10.0.${i}.1` })).status, 201);
  }
  assert.equal((await t.post(comment(), { ip: '10.9.9.9' })).status, 429);
  assert.equal(t.emails.length, GLOBAL_PER_HOUR);
});

test('if the email cannot be sent the comment is still saved, still pending', async () => {
  const t = setup({ emailFails: true });
  assert.equal((await t.post(comment())).status, 201);
  assert.equal([...t.store.rows.values()][0].status, 'pending');
});

test('unknown pages and routes are 404, preflight is answered', async () => {
  const t = setup();
  assert.equal((await t.handle(new Request(`${BASE}/comments?page=secret`))).status, 404);
  assert.equal((await t.handle(new Request(`${BASE}/admin`))).status, 404);
  const pre = await t.handle(new Request(`${BASE}/comments`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});
