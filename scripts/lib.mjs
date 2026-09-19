// Pure helpers for the site build. No filesystem or network access in here, so
// everything can be unit tested.

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

// Slugs that would collide with the landing page's own files.
const RESERVED = new Set(['art', 'index.html', '404.html', 'style.css', 'versions.json']);

// Top-level entries of a no-build ("static") game repo that are not part of the
// playable site. Everything else is copied, so a new folder in a game just works.
const STATIC_EXCLUDE = new Set([
  'node_modules', 'test', 'tests', 'dist', 'Makefile',
  'package.json', 'package-lock.json', 'CNAME',
]);

export function validateGames(games) {
  if (!Array.isArray(games) || games.length === 0) {
    throw new Error('games.json must be a non-empty array');
  }
  const seen = new Set();
  for (const g of games) {
    const where = `games.json entry ${JSON.stringify(g.slug ?? g.title ?? g)}`;
    if (!SLUG.test(g.slug ?? '')) throw new Error(`${where}: slug must be lowercase-with-dashes`);
    if (RESERVED.has(g.slug)) throw new Error(`${where}: slug is reserved by the landing page`);
    if (seen.has(g.slug)) throw new Error(`${where}: duplicate slug`);
    seen.add(g.slug);
    if (!REPO.test(g.repo ?? '')) throw new Error(`${where}: repo must look like owner/name`);
    for (const key of ['title', 'blurb', 'kind']) {
      if (typeof g[key] !== 'string' || !g[key].trim()) throw new Error(`${where}: missing ${key}`);
    }
    if (Boolean(g.build) !== Boolean(g.out)) {
      throw new Error(`${where}: build and out go together (set both, or neither for a static game)`);
    }
    for (const key of ['bg', 'ink', 'accent']) {
      if (!HEX.test(g.colors?.[key] ?? '')) throw new Error(`${where}: colors.${key} must be a #rrggbb hex`);
    }
  }
  return games;
}

// Should this top-level entry of a static game repo be published?
export function shouldCopyStatic(name) {
  if (name.startsWith('.')) return false;
  if (name.toLowerCase().endsWith('.md')) return false;
  return !STATIC_EXCLUDE.has(name);
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderPoster(game) {
  const { slug, title, blurb, kind, colors } = game;
  const style = `--bg:${colors.bg};--ink:${colors.ink};--accent:${colors.accent}`;
  return `<li class="poster" style="${style}">
  <a href="${slug}/" aria-label="Play ${escapeHtml(title)}">
    <img class="poster-art" src="art/${slug}.svg" alt="" width="600" height="360" loading="lazy">
    <span class="poster-kind">${escapeHtml(kind)}</span>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(blurb)}</p>
    <span class="poster-play">Play ${escapeHtml(title)}</span>
  </a>
</li>`;
}

export const POSTERS_MARKER = '<!-- POSTERS -->';

export function renderLanding(template, games) {
  if (!template.includes(POSTERS_MARKER)) {
    throw new Error(`landing/index.html is missing the ${POSTERS_MARKER} marker`);
  }
  return template.replace(POSTERS_MARKER, games.map(renderPoster).join('\n'));
}

// Which games have moved on from what is live? `deployed` is the versions.json
// from the live site (or null if there is none yet), `current` is slug -> sha now.
export function changedGames(deployed, current) {
  return Object.keys(current).filter((slug) => !deployed || deployed[slug] !== current[slug]);
}
