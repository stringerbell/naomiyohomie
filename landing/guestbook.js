// The guestbook on the landing page. Talks to the comments Worker (comments/).
// Comment text is only ever put on the page with textContent, never as HTML.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
// Cloudflare's public Turnstile test key: always passes, only useful locally.
const TEST_SITEKEY = '1x00000000000000000000AA';
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// Where the API is and which Turnstile key to use. Returns null when the
// guestbook is not set up yet, and the section then stays hidden.
export function resolveConfig(hostname, dataset) {
  if (LOCAL_HOSTS.has(hostname)) return { api: 'http://localhost:8787', sitekey: TEST_SITEKEY };
  const api = (dataset.api ?? '').replace(/\/+$/, '');
  const sitekey = dataset.sitekey ?? '';
  if (!/^https:\/\//.test(api) || !sitekey) return null;
  return { api, sitekey };
}

export function formatDate(seconds, locale) {
  return new Date(seconds * 1000).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderComment(c) {
  const item = el('li', 'note');
  const head = el('p', 'note-head');
  head.append(el('span', 'note-name', c.name), ' ', el('time', 'note-date', formatDate(c.createdAt)));
  item.append(head, el('p', 'note-text', c.message));
  if (c.reply) {
    const reply = el('div', 'note-reply');
    reply.append(el('p', 'note-reply-who', 'Naomi says'), el('p', 'note-text', c.reply));
    item.append(reply);
  }
  return item;
}

async function loadComments(config, list, status) {
  try {
    const res = await fetch(`${config.api}/comments?page=guestbook`);
    if (!res.ok) throw new Error(String(res.status));
    const { comments } = await res.json();
    list.replaceChildren(...comments.map(renderComment));
    status.textContent = comments.length ? '' : 'Nobody has signed yet. You could be the first!';
  } catch {
    status.textContent = 'The messages could not be loaded right now. Try again in a little while.';
  }
}

let turnstileReady;
function loadTurnstile() {
  turnstileReady ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.append(script);
  });
  return turnstileReady;
}

function setUpForm(config, form) {
  const say = form.querySelector('[data-form-status]');
  const button = form.querySelector('button');
  let widgetId = null;
  let token = '';

  // The "are you a person" check is a third-party script, so it only loads
  // once someone actually starts writing.
  const startCheck = async () => {
    if (widgetId !== null) return;
    widgetId = 'loading';
    try {
      const turnstile = await loadTurnstile();
      widgetId = turnstile.render(form.querySelector('[data-turnstile]'), {
        sitekey: config.sitekey,
        callback: (t) => { token = t; },
        'expired-callback': () => { token = ''; },
        'error-callback': () => { token = ''; },
      });
    } catch {
      widgetId = null;
      say.textContent = 'The "are you a person" check could not load. Check your connection and reload the page.';
    }
  };
  form.addEventListener('focusin', startCheck, { once: true });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await startCheck();
    if (!token) {
      say.textContent = 'One moment, still checking that you are a person. Then press the button again.';
      return;
    }
    button.disabled = true;
    say.textContent = 'Sending...';
    const data = new FormData(form);
    try {
      const res = await fetch(`${config.api}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: 'guestbook',
          name: data.get('name'),
          message: data.get('message'),
          website: data.get('website'),
          turnstileToken: token,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        form.reset();
        say.textContent = 'Thank you! Your message will show up here after a grown-up has read it.';
      } else {
        say.textContent = body.error ?? 'That did not work. Try again in a minute.';
        if (body.field) form.elements[body.field]?.focus();
      }
    } catch {
      say.textContent = 'That did not send. Check your connection and try again.';
    } finally {
      button.disabled = false;
      // A Turnstile token works once; get a fresh one for the next try.
      token = '';
      if (window.turnstile && typeof widgetId === 'string' && widgetId !== 'loading') window.turnstile.reset(widgetId);
    }
  });
}

if (typeof document !== 'undefined') {
  const section = document.getElementById('guestbook');
  const config = section && resolveConfig(location.hostname, section.dataset);
  if (config) {
    section.hidden = false;
    loadComments(config, section.querySelector('[data-notes]'), section.querySelector('[data-notes-status]'));
    setUpForm(config, section.querySelector('form'));
  }
}
