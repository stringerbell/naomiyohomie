import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LINK_TTL_SECONDS, MESSAGE_MAX, NAME_MAX, buildEmail, clean, containsLink, hashIp, moderationUrl,
  personalInfoFlags, signLink, validateComment, validateReply, verifyLink,
} from '../src/lib.js';

const SECRET = 'test-secret-test-secret-test-secret-1234';
const ok = (over = {}) => ({ page: 'guestbook', name: 'Sam', message: 'I love the giraffe game!', ...over });

test('containsLink catches the ways spam writes links', () => {
  for (const text of ['visit http://x.y', 'HTTPS://EVIL.example', 'www.spam.biz', 'go to cheap-pills.com now',
    'my site is cool.io', 'ftp://files', 'bit.ly/abc']) {
    assert.equal(containsLink(text), true, text);
  }
});

test('containsLink leaves normal kid writing alone', () => {
  for (const text of ['I love it.So fun', 'wait...what', 'Score was 3.5 out of 5', 'best.game.ever',
    'My dog is called Dot. Come play!', 'e.g. the koala']) {
    assert.equal(containsLink(text), false, text);
  }
});

test('clean strips control and invisible direction characters, and tidies spaces', () => {
  assert.equal(clean('  hi \t there\u0000\u0007 '), 'hi there');
  assert.equal(clean('a‮b​c'), 'a b c');
  assert.equal(clean('Sam\r\nBcc: x@y.z'), 'Sam Bcc: x@y.z', 'single-line fields lose their newlines');
});

test('clean keeps message line breaks but caps blank lines', () => {
  assert.equal(clean('one\r\ntwo\n\n\n\n\nthree  ', { multiline: true }), 'one\ntwo\n\nthree');
});

test('validateComment accepts a normal comment and returns the cleaned text', () => {
  const r = validateComment(ok({ name: '  Sam  ', message: ' Hi\u0000 Naomi! ' }));
  assert.deepEqual(r, { ok: true, comment: { page: 'guestbook', name: 'Sam', message: 'Hi Naomi!' } });
});

test('validateComment ignores fields it does not know about', () => {
  const r = validateComment(ok({ status: 'approved', reply: 'pwned', id: 'x' }));
  assert.deepEqual(Object.keys(r.comment).sort(), ['message', 'name', 'page']);
});

test('validateComment rejects unknown pages, empties, and whitespace-only text', () => {
  assert.equal(validateComment(ok({ page: 'admin' })).field, 'page');
  assert.equal(validateComment(ok({ name: ' ​ ' })).field, 'name');
  assert.equal(validateComment(ok({ message: '\n\n ' })).field, 'message');
  assert.equal(validateComment(undefined).ok, false);
  assert.equal(validateComment({ page: 'guestbook', name: {}, message: [] }).ok, false);
});

test('validateComment enforces length limits by visible characters, not bytes', () => {
  assert.equal(validateComment(ok({ name: 'x'.repeat(NAME_MAX) })).ok, true);
  assert.equal(validateComment(ok({ name: 'x'.repeat(NAME_MAX + 1) })).field, 'name');
  assert.equal(validateComment(ok({ message: '🦒'.repeat(MESSAGE_MAX) })).ok, true);
  assert.equal(validateComment(ok({ message: 'x'.repeat(MESSAGE_MAX + 1) })).field, 'message');
});

test('validateComment rejects links in either field', () => {
  assert.equal(validateComment(ok({ name: 'www.spam.com' })).field, 'name');
  assert.equal(validateComment(ok({ message: 'nice! http://spam.example' })).field, 'message');
});

test('validateReply allows an empty reply and caps the length', () => {
  assert.deepEqual(validateReply(null), { ok: true, reply: '' });
  assert.deepEqual(validateReply('  Thanks!  '), { ok: true, reply: 'Thanks!' });
  assert.equal(validateReply('x'.repeat(601)).ok, false);
});

test('personalInfoFlags points out contact details and chat apps', () => {
  assert.deepEqual(personalInfoFlags('Great game!'), []);
  assert.equal(personalInfoFlags('email me at kid@example.org').length, 1);
  assert.equal(personalInfoFlags('call 555 123 4567').length, 1);
  assert.match(personalInfoFlags('add me on Discord').join(), /chat app/);
  assert.match(personalInfoFlags('I am 9 years old').join(), /personal/);
});

test('a signed link verifies, and any tampering breaks it', async () => {
  const exp = 2_000_000_000;
  const sig = await signLink(SECRET, 'abc', exp);
  const now = 1_900_000_000;
  assert.equal(await verifyLink(SECRET, { id: 'abc', exp, sig }, now), true);
  assert.equal(await verifyLink(SECRET, { id: 'abd', exp, sig }, now), false, 'different comment');
  assert.equal(await verifyLink(SECRET, { id: 'abc', exp: exp + 1, sig }, now), false, 'extended expiry');
  assert.equal(await verifyLink(SECRET, { id: 'abc', exp, sig: sig.slice(0, -2) + 'AA' }, now), false, 'edited signature');
  assert.equal(await verifyLink('another-secret-another-secret-another-1', { id: 'abc', exp, sig }, now), false);
});

test('verifyLink rejects expired and malformed links without throwing', async () => {
  const sig = await signLink(SECRET, 'abc', 100);
  assert.equal(await verifyLink(SECRET, { id: 'abc', exp: 100, sig }, 101), false, 'expired');
  for (const link of [{}, { id: 'abc' }, { id: 'abc', exp: 'soon', sig }, { id: 'abc', exp: 100, sig: '!!!' },
    { id: null, exp: null, sig: null }, { id: 'abc', exp: '1e9', sig }]) {
    assert.equal(await verifyLink(SECRET, link, 50), false, JSON.stringify(link));
  }
});

test('signing refuses a missing or weak secret', async () => {
  await assert.rejects(() => signLink('', 'abc', 1), /MOD_SECRET/);
  await assert.rejects(() => signLink('short', 'abc', 1), /MOD_SECRET/);
});

test('moderationUrl builds a link that verifies', async () => {
  const url = new URL(await moderationUrl(SECRET, 'https://comments.example', 'id-1', 1000));
  assert.equal(url.origin + url.pathname, 'https://comments.example/moderate');
  const link = Object.fromEntries(url.searchParams);
  assert.equal(Number(link.exp), 1000 + LINK_TTL_SECONDS);
  assert.equal(await verifyLink(SECRET, link, 1000), true);
});

test('hashIp is stable within a day, differs per IP, rotates daily, and hides the IP', async () => {
  const day = 86400 * 20000;
  const a = await hashIp(SECRET, '203.0.113.7', day + 10);
  assert.equal(a, await hashIp(SECRET, '203.0.113.7', day + 80000));
  assert.notEqual(a, await hashIp(SECRET, '203.0.113.8', day + 10));
  assert.notEqual(a, await hashIp(SECRET, '203.0.113.7', day + 86400));
  assert.ok(!a.includes('203'));
});

const decodeBody = (raw) => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

test('buildEmail says the comment is not public and includes the review link', () => {
  const raw = buildEmail({
    from: 'guestbook@example.com', to: 'mod@example.com', messageIdDomain: 'comments.example',
    comment: { id: 'id-1', name: 'Sam', message: 'Hello 🦒' }, reviewUrl: 'https://comments.example/moderate?id=id-1',
    now: new Date(Date.UTC(2026, 8, 19, 12, 0, 0)),
  });
  const body = decodeBody(raw);
  assert.match(body, /NOT visible/);
  assert.match(body, /From: Sam/);
  assert.match(body, /Hello 🦒/);
  assert.match(body, /https:\/\/comments\.example\/moderate\?id=id-1/);
  assert.match(raw, /^To: <mod@example\.com>\r$/m);
  assert.match(raw, /^Date: Sat, 19 Sep 2026 12:00:00 \+0000\r$/m);
});

test('buildEmail cannot be used to inject headers', () => {
  const raw = buildEmail({
    from: 'guestbook@example.com', to: 'mod@example.com', messageIdDomain: 'comments.example',
    comment: { id: 'id-1', name: 'Sam\r\nBcc: victim@example.com', message: 'x\r\n\r\nSubject: hi' },
    reviewUrl: 'https://comments.example/moderate',
  });
  const headers = raw.split('\r\n\r\n')[0];
  assert.ok(!/Bcc/i.test(headers), 'user text must never reach the headers');
  assert.equal(headers.match(/^Subject:/gm).length, 1);
  assert.equal(raw.split('\r\n\r\n').length, 2, 'exactly one header/body boundary');
});

test('buildEmail flags personal details for the moderator', () => {
  const raw = buildEmail({
    from: 'a@example.com', to: 'b@example.com', messageIdDomain: 'c.example',
    comment: { id: '1', name: 'Sam', message: 'add me on snapchat' }, reviewUrl: 'https://c.example/m',
  });
  assert.match(decodeBody(raw), /Heads up: mentions a social or chat app/);
});
