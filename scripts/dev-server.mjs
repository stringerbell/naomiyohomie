// A small static server for local previews, with live reload. The reload
// script is added to HTML as it is served; files in dist/ are never touched,
// so nothing of this can reach the published site.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

export const RELOAD_PATH = '/__reload';
const RELOAD_SNIPPET = `<script>new EventSource('${RELOAD_PATH}').onmessage = () => location.reload();</script>`;

export function contentType(file) {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function injectReload(html) {
  const at = html.lastIndexOf('</body>');
  return at === -1 ? html + RELOAD_SNIPPET : html.slice(0, at) + RELOAD_SNIPPET + html.slice(at);
}

// Maps a URL path to a file inside root, or null if it would escape root.
export function resolveInside(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const base = resolve(root);
  const file = resolve(join(base, normalize(decoded)));
  return file === base || file.startsWith(base + sep) ? file : null;
}

export function createDevServer({ root }) {
  const clients = new Set();

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === RELOAD_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    let file = resolveInside(root, url.pathname);
    if (file && existsSync(file) && statSync(file).isDirectory()) {
      // Same as GitHub Pages: /game -> /game/ so the game's relative URLs resolve.
      if (!url.pathname.endsWith('/')) {
        res.writeHead(301, { Location: `${url.pathname}/${url.search}` });
        return res.end();
      }
      file = join(file, 'index.html');
    }

    let status = 200;
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      status = 404;
      file = join(root, '404.html');
      if (!existsSync(file)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
    }

    const headers = { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' };
    if (extname(file) === '.html') {
      res.writeHead(status, headers);
      return res.end(injectReload(readFileSync(file, 'utf8')));
    }
    res.writeHead(status, headers);
    createReadStream(file).pipe(res);
  });

  return {
    server,
    clientCount: () => clients.size,
    reload() { for (const client of clients) client.write('data: reload\n\n'); },
    close() {
      for (const client of clients) client.end();
      return new Promise((done) => server.close(done));
    },
  };
}
