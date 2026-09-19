// Pure rules for the guestbook: what a comment may contain, moderation link
// signing, and the moderation email. No Cloudflare bindings in here, so it all
// runs under `node --test`.

export const PAGES = new Set(['guestbook']);
export const NAME_MAX = 30;
export const MESSAGE_MAX = 600;
export const REPLY_MAX = 600;

// Moderation links stay valid this long, so a published comment can still be
// taken down, or replied to, well after the email arrived.
export const LINK_TTL_SECONDS = 180 * 24 * 60 * 60;

const TLDS = 'com|net|org|io|co|ru|cn|xyz|info|biz|ly|me|tv|gg|app|dev|shop|site|online|top|link|click|uk|de|fr|us';
const LINK = new RegExp(`(https?:|ftp:|www\\.|\\b[a-z0-9-]+\\.(?:${TLDS})\\b)`, 'i');

export function containsLink(text) {
  return LINK.test(text);
}

// Removes control characters (incl. CR/LF tricks), trims, and tidies whitespace.
// Line breaks survive in messages but are capped at one blank line.
export function clean(text, { multiline = false } = {}) {
  let out = String(text ?? '').normalize('NFC').replace(/\r\n?/g, '\n');
  out = out.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g
    : /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, ' ');
  out = out.replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

// Returns { ok: true, comment } or { ok: false, field, error } with a message
// written for the person filling in the form.
export function validateComment(input) {
  const page = String(input?.page ?? '');
  if (!PAGES.has(page)) return { ok: false, field: 'page', error: 'That page does not take comments.' };

  const name = clean(input?.name);
  if (!name) return { ok: false, field: 'name', error: 'Add a name or nickname.' };
  if ([...name].length > NAME_MAX) return { ok: false, field: 'name', error: `Keep the name under ${NAME_MAX} letters.` };
  if (containsLink(name)) return { ok: false, field: 'name', error: 'Names can\'t have web links in them.' };

  const message = clean(input?.message, { multiline: true });
  if (!message) return { ok: false, field: 'message', error: 'Write a message first.' };
  if ([...message].length > MESSAGE_MAX) {
    return { ok: false, field: 'message', error: `That is a bit long. Keep it under ${MESSAGE_MAX} letters.` };
  }
  if (containsLink(message)) return { ok: false, field: 'message', error: 'Messages can\'t have web links in them.' };

  return { ok: true, comment: { page, name, message } };
}

export function validateReply(text) {
  const reply = clean(text, { multiline: true });
  if ([...reply].length > REPLY_MAX) return { ok: false, error: `Keep the reply under ${REPLY_MAX} letters.` };
  return { ok: true, reply };
}

// Things the moderator should look twice at. These never block a comment;
// they are called out at the top of the email.
export function personalInfoFlags(text) {
  const flags = [];
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) flags.push('looks like it contains an email address');
  if (/(?:\+?\d[\s().-]?){7,}/.test(text)) flags.push('looks like it contains a phone number');
  if (/\b(snap(chat)?|insta(gram)?|tiktok|discord|whatsapp|telegram|roblox|kik)\b/i.test(text)) {
    flags.push('mentions a social or chat app');
  }
  if (/\b(my address|i live (at|on)|my school|years? old|\bage\b)/i.test(text)) flags.push('may share personal details');
  return flags;
}

// ---------- signed moderation links ----------

const enc = new TextEncoder();

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromB64url(text) {
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  if (!secret || secret.length < 32) throw new Error('MOD_SECRET must be at least 32 characters');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signLink(secret, id, exp) {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`moderate.${id}.${exp}`)));
}

export async function verifyLink(secret, { id, exp, sig }, nowSeconds) {
  if (!id || !sig || !/^\d+$/.test(String(exp ?? ''))) return false;
  if (Number(exp) < nowSeconds) return false;
  let bytes;
  try { bytes = fromB64url(String(sig)); } catch { return false; }
  // subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', await hmacKey(secret), bytes, enc.encode(`moderate.${id}.${exp}`));
}

export async function moderationUrl(secret, publicUrl, id, nowSeconds) {
  const exp = nowSeconds + LINK_TTL_SECONDS;
  const sig = await signLink(secret, id, exp);
  return `${publicUrl}/moderate?id=${encodeURIComponent(id)}&exp=${exp}&sig=${sig}`;
}

// Not reversible, and changes every day, so it can rate-limit without being a
// long-lived record of who commented.
export async function hashIp(secret, ip, nowSeconds) {
  const day = Math.floor(nowSeconds / 86400);
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`ip.${day}.${ip}`))).slice(0, 22);
}

// ---------- the moderation email ----------

function b64utf8(text) {
  return btoa(String.fromCharCode(...enc.encode(text)));
}

// No user-supplied text goes in the headers, and the body is base64-encoded, so
// a name or message can never add headers or break out of the body.
export function buildEmail({ from, to, comment, reviewUrl, messageIdDomain, now = new Date() }) {
  const flags = personalInfoFlags(`${comment.name}\n${comment.message}`);
  const body = [
    `New guestbook comment, waiting for your review. It is NOT visible on the site yet.`,
    ``,
    ...(flags.length ? [`Heads up: ${flags.join('; ')}.`, ``] : []),
    `From: ${comment.name}`,
    ``,
    comment.message,
    ``,
    `Review it (approve, reject, or add a reply from Naomi):`,
    reviewUrl,
    ``,
    `Opening the link changes nothing. You choose on the page.`,
  ].join('\n');

  const wrapped = b64utf8(body).replace(/.{1,76}/g, '$&\r\n').trimEnd();
  return [
    `From: "Naomi's guestbook" <${from}>`,
    `To: <${to}>`,
    `Subject: Guestbook: a new comment is waiting for you`,
    `Message-ID: <${comment.id}@${messageIdDomain}>`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrapped,
    ``,
  ].join('\r\n');
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
