// The guestbook's HTTP behaviour. Everything it touches (database, email,
// Turnstile, clock) is passed in, so tests drive it with fakes and index.js
// wires up the real Cloudflare bindings.
//
//   GET  /comments?page=guestbook   approved comments only, as JSON
//   POST /comments                  new comment -> saved as pending, moderator emailed
//   GET  /moderate?id&exp&sig       review page (changes nothing: mail scanners open links)
//   POST /moderate                  approve / reject / save Naomi's reply

import {
  PAGES, buildEmail, hashIp, moderationUrl, validateComment, validateReply, verifyLink,
} from './lib.js';
import { renderReviewPage, renderMessagePage } from './pages.js';

export const PER_IP_PER_HOUR = 3;
// Caps how many emails a flood can put in the moderator's inbox.
export const GLOBAL_PER_HOUR = 30;
const MAX_BODY_BYTES = 8 * 1024;

export function createApp({ store, sendEmail, verifyTurnstile, config, now = () => Date.now() }) {
  const allowedOrigins = new Set(config.allowedOrigins);
  const seconds = () => Math.floor(now() / 1000);

  function cors(request) {
    const origin = request.headers.get('Origin');
    if (!origin || !allowedOrigins.has(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  }

  const json = (request, status, body, extra = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...cors(request), ...extra },
  });

  const html = (status, body) => new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
    },
  });

  async function listComments(request, url) {
    const page = url.searchParams.get('page') ?? '';
    if (!PAGES.has(page)) return json(request, 404, { error: 'That page does not take comments.' });
    const rows = await store.listApproved(page);
    const comments = rows.map((r) => ({
      id: r.id, name: r.name, message: r.message, createdAt: r.created_at, reply: r.reply || null,
    }));
    return json(request, 200, { comments }, { 'Cache-Control': 'public, max-age=30' });
  }

  async function submitComment(request) {
    // Browsers always send Origin on cross-site POSTs; anything else is a script.
    if (!allowedOrigins.has(request.headers.get('Origin') ?? '')) {
      return json(request, 403, { error: 'Comments can only be sent from the website.' });
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(request, 413, { error: 'That is too long.' });
    let input;
    try { input = JSON.parse(raw); } catch { return json(request, 400, { error: 'Could not read that comment.' }); }

    // Honeypot: people never see this field. Pretend it worked so bots move on.
    if (input?.website) return json(request, 200, { ok: true });

    const result = validateComment(input);
    if (!result.ok) return json(request, 422, { error: result.error, field: result.field });

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await verifyTurnstile(input.turnstileToken, ip))) {
      return json(request, 403, { error: 'The "are you a person" check did not pass. Reload the page and try again.' });
    }

    const at = seconds();
    const ipHash = await hashIp(config.modSecret, ip, at);
    const since = at - 3600;
    if ((await store.countSince(since, ipHash)) >= PER_IP_PER_HOUR) {
      return json(request, 429, { error: 'That is a lot of comments! Try again in an hour.' });
    }
    if ((await store.countSince(since)) >= GLOBAL_PER_HOUR) {
      return json(request, 429, { error: 'The guestbook is very busy right now. Try again in an hour.' });
    }

    const comment = { id: crypto.randomUUID(), ...result.comment, ipHash, createdAt: at };
    await store.insert(comment);

    try {
      const reviewUrl = await moderationUrl(config.modSecret, config.publicUrl, comment.id, at);
      await sendEmail(buildEmail({
        from: config.fromEmail, to: config.modEmail, comment, reviewUrl,
        messageIdDomain: new URL(config.publicUrl).hostname, now: new Date(now()),
      }));
    } catch (err) {
      // The comment is safely stored as pending; it just was not announced.
      console.error('moderation email failed', comment.id, err?.message ?? err);
    }
    return json(request, 201, { ok: true });
  }

  async function reviewPage(url) {
    const link = { id: url.searchParams.get('id'), exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig') };
    if (!(await verifyLink(config.modSecret, link, seconds()))) {
      return html(403, renderMessagePage('This link is not valid', 'It may have expired, or been cut off when it was copied.'));
    }
    const comment = await store.get(link.id);
    if (!comment) return html(404, renderMessagePage('Comment not found', 'It may have been deleted.'));
    return html(200, renderReviewPage(comment, link));
  }

  async function moderate(request) {
    const form = await request.formData();
    const link = { id: form.get('id'), exp: form.get('exp'), sig: form.get('sig') };
    if (!(await verifyLink(config.modSecret, link, seconds()))) {
      return html(403, renderMessagePage('This link is not valid', 'It may have expired. Nothing was changed.'));
    }
    const comment = await store.get(link.id);
    if (!comment) return html(404, renderMessagePage('Comment not found', 'It may have been deleted.'));

    const action = form.get('action');
    if (action !== 'approve' && action !== 'reject') {
      return html(400, renderMessagePage('Nothing was changed', 'Choose approve or reject.'));
    }
    const reply = validateReply(form.get('reply'));
    if (!reply.ok) return html(422, renderReviewPage(comment, link, reply.error));

    const status = action === 'approve' ? 'approved' : 'rejected';
    // A rejected comment never carries a public reply.
    await store.decide(link.id, status, status === 'approved' ? reply.reply : '', seconds());
    return html(200, renderReviewPage(await store.get(link.id), link, null,
      status === 'approved' ? 'Saved. The comment is on the site.' : 'Saved. The comment is hidden.'));
  }

  return async function handle(request) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
      if (url.pathname === '/comments' && request.method === 'GET') return await listComments(request, url);
      if (url.pathname === '/comments' && request.method === 'POST') return await submitComment(request);
      if (url.pathname === '/moderate' && request.method === 'GET') return await reviewPage(url);
      if (url.pathname === '/moderate' && request.method === 'POST') return await moderate(request);
      return json(request, 404, { error: 'Not found' });
    } catch (err) {
      console.error('unhandled', err?.stack ?? err);
      return json(request, 500, { error: 'Something went wrong on our side. Try again in a minute.' });
    }
  };
}
