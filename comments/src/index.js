// Worker entry: wires the real Cloudflare bindings into the app.

import { EmailMessage } from 'cloudflare:email';
import { createApp } from './app.js';
import { d1Store } from './store.js';

async function turnstile(secret, token, ip) {
  if (!token || typeof token !== 'string') return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  return res.ok && (await res.json()).success === true;
}

export default {
  async fetch(request, env) {
    const handle = createApp({
      store: d1Store(env.DB),
      verifyTurnstile: (token, ip) => turnstile(env.TURNSTILE_SECRET, token, ip),
      sendEmail: (raw) => env.MAIL.send(new EmailMessage(env.FROM_EMAIL, env.MOD_EMAIL, raw)),
      config: {
        modSecret: env.MOD_SECRET,
        modEmail: env.MOD_EMAIL,
        fromEmail: env.FROM_EMAIL,
        publicUrl: env.PUBLIC_URL,
        allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
      },
    });
    return handle(request);
  },
};
