// Liefert die Weboberflaeche aus – aus dem Dateisystem (Entwicklung/Docker) oder,
// in der Windows-Einzel-Exe, aus den eingebetteten SEA-Assets.
import fs from 'node:fs';
import path from 'node:path';
import sea from 'node:sea';
import { runtime } from '../runtime.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const ALIASES = {
  '/': 'index.html',
  '/overlay': 'overlay.html',
};

const webRoot = path.join(runtime.repoRoot, 'src', 'web');
const memo = new Map();

function load(rel) {
  if (memo.has(rel)) return memo.get(rel);
  let data = null;
  if (runtime.isSea) {
    try {
      data = Buffer.from(sea.getAsset(`web/${rel}`));
    } catch {
      data = null;
    }
    memo.set(rel, data); // eingebettete Dateien aendern sich nie
  } else {
    const file = path.join(webRoot, rel);
    if (file.startsWith(webRoot) && fs.existsSync(file) && fs.statSync(file).isFile()) data = fs.readFileSync(file);
  }
  return data;
}

/** @returns {boolean} true, wenn eine Datei ausgeliefert wurde */
export function serveAsset(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel = ALIASES[url.pathname] || decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!rel || rel.includes('..') || rel.includes('\0')) return false;
  if (!path.extname(rel)) rel = `${rel}.html`;
  const data = load(rel);
  if (!data) return false;
  const ext = path.extname(rel);
  const etag = `"${runtime.version}-${data.length}"`;
  if (runtime.isSea && req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    res.end();
    return true;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': data.length,
    // Fonts duerfen lange gecacht werden; alles andere immer frisch (Updates sofort sichtbar).
    'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(runtime.isSea ? { ETag: etag } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}
