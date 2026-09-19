// The moderator's pages. Every value from a comment goes through escapeHtml.

import { REPLY_MAX, escapeHtml, personalInfoFlags } from './lib.js';

const STATUS_TEXT = {
  pending: 'Waiting for you. Not on the site.',
  approved: 'Approved. On the site now.',
  rejected: 'Rejected. Not on the site.',
};

const shell = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; background: #2747D8; color: #14123A; font: 1.05rem/1.5 system-ui, sans-serif; }
  main { width: min(100% - 2rem, 38rem); margin: 2.5rem auto; background: #FDFBF4; border-radius: 8px; padding: 1.75rem; box-sizing: border-box; }
  h1 { font-size: 1.5rem; line-height: 1.2; margin: 0 0 1rem; }
  .status, .notice, .problem, .flags { padding: .6rem .85rem; border-radius: 6px; margin: 0 0 1rem; }
  .status { background: #E8E6F5; }
  .notice { background: #CDF3E1; }
  .problem, .flags { background: #FFE0D6; }
  blockquote { margin: 0 0 1.5rem; padding: 1rem 1.15rem; background: #fff; border-left: 5px solid #FFC93C; white-space: pre-wrap; overflow-wrap: anywhere; }
  .who { font-weight: 700; margin: 0 0 .25rem; }
  label { display: block; font-weight: 700; margin-bottom: .35rem; }
  .hint { font-weight: 400; color: #4a4870; }
  textarea { width: 100%; box-sizing: border-box; min-height: 7rem; padding: .6rem; font: inherit; border: 2px solid #14123A; border-radius: 6px; }
  .actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1.25rem; }
  button { font: inherit; font-weight: 700; padding: .65rem 1.2rem; border-radius: 999px; border: 2px solid #14123A; cursor: pointer; }
  .approve { background: #14123A; color: #FDFBF4; }
  .reject { background: transparent; color: #14123A; }
  button:focus-visible, textarea:focus-visible { outline: 4px solid #FFC93C; outline-offset: 2px; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;

export function renderMessagePage(title, detail) {
  return shell(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>`);
}

export function renderReviewPage(comment, link, problem = null, notice = null) {
  const flags = personalInfoFlags(`${comment.name}\n${comment.message}`);
  const approved = comment.status === 'approved';
  return shell('Review guestbook comment', `
<h1>Guestbook comment</h1>
${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ''}
${problem ? `<p class="problem" role="alert">${escapeHtml(problem)}</p>` : ''}
<p class="status">${escapeHtml(STATUS_TEXT[comment.status] ?? comment.status)}</p>
${flags.length ? `<p class="flags">Heads up: ${escapeHtml(flags.join('; '))}.</p>` : ''}
<p class="who">${escapeHtml(comment.name)} wrote:</p>
<blockquote>${escapeHtml(comment.message)}</blockquote>
<form method="post" action="/moderate">
  <input type="hidden" name="id" value="${escapeHtml(link.id)}">
  <input type="hidden" name="exp" value="${escapeHtml(link.exp)}">
  <input type="hidden" name="sig" value="${escapeHtml(link.sig)}">
  <label for="reply">Naomi's reply <span class="hint">(optional, shown under the comment)</span></label>
  <textarea id="reply" name="reply" maxlength="${REPLY_MAX}">${escapeHtml(comment.reply ?? '')}</textarea>
  <div class="actions">
    <button class="approve" name="action" value="approve">${approved ? 'Save reply and keep on the site' : 'Approve and put on the site'}</button>
    <button class="reject" name="action" value="reject">${approved ? 'Take it off the site' : 'Reject'}</button>
  </div>
</form>`);
}
