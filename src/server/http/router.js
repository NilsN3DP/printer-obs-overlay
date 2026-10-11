// Minimaler HTTP-Router auf node:http – haelt das Projekt frei von Laufzeit-Abhaengigkeiten.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function readBody(req, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, `Anfrage zu gross (max. ${Math.round(limitBytes / 1048576)} MB)`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limitBytes = 2 * 1024 * 1024) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    throw new HttpError(415, 'Erwarte application/json');
  }
  const raw = await readBody(req, limitBytes);
  try {
    return raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Ungültiges JSON');
  }
}

/**
 * Schutz gegen Cross-Site-Requests aus fremden Webseiten: aendernde Anfragen muessen
 * vom selben Host kommen (Origin-Header) – Browser setzen ihn bei POST/PUT immer.
 */
export function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    if (new URL(origin).host !== req.headers.host) throw new Error();
  } catch {
    throw new HttpError(403, 'Fremde Herkunft abgelehnt');
  }
}

export function createRouter() {
  const routes = [];
  const add = (method) => (path, handler) => routes.push({ method, path, handler });
  return {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    /** @returns {boolean} true, wenn eine Route gegriffen hat */
    async handle(req, res, url) {
      const route = routes.find((r) => r.method === req.method && r.path === url.pathname);
      if (!route) return false;
      try {
        if (req.method !== 'GET') assertSameOrigin(req);
        await route.handler(req, res, url);
      } catch (err) {
        if (!res.headersSent) sendJson(res, err.status || 500, { ok: false, error: err.message });
        else res.destroy();
      }
      return true;
    },
  };
}
