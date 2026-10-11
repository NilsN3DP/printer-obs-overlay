// HTTP-Zugriff auf einen Drucker inkl. Authentifizierung.
//   - API-Key   -> Header X-Api-Key (PrusaLink, OctoPrint, optional Moonraker)
//   - Benutzer/Passwort -> HTTP Digest (PrusaLink), Fallback Basic
// Die Digest-Challenge wird gemerkt und mit hochzaehlendem Nonce-Counter wiederverwendet,
// sodass im Normalfall nur ein Request pro Abfrage noetig ist.
import crypto from 'node:crypto';

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

export function parseDigestChallenge(header) {
  if (!header || !/^Digest\s/i.test(header)) return null;
  const fields = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]*))/g;
  let match;
  const body = header.replace(/^Digest\s+/i, '');
  while ((match = re.exec(body))) fields[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
  return fields.realm !== undefined && fields.nonce ? fields : null;
}

export function buildDigestHeader({ username, password, challenge, method, uri, nc, cnonce }) {
  const qop = String(challenge.qop || '').split(',').map((v) => v.trim()).includes('auth') ? 'auth' : '';
  const algorithm = String(challenge.algorithm || 'MD5').toUpperCase();
  const ncHex = nc.toString(16).padStart(8, '0');
  const ha1Base = md5(`${username}:${challenge.realm}:${password}`);
  const ha1 = algorithm === 'MD5-SESS' ? md5(`${ha1Base}:${challenge.nonce}:${cnonce}`) : ha1Base;
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${ncHex}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

export class PrinterClient {
  /** @param {{host: string, apiKey?: string, username?: string, password?: string}} printer */
  constructor(printer) {
    this.host = printer.host;
    this.apiKey = printer.apiKey || '';
    this.username = printer.username || '';
    this.password = printer.password || '';
    this.digest = null; // { challenge, nc, cnonce }
  }

  url(pathOrUrl) {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `http://${this.host}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }

  authHeader(method, uri) {
    if (!this.digest) return null;
    this.digest.nc += 1;
    return buildDigestHeader({
      username: this.username,
      password: this.password,
      challenge: this.digest.challenge,
      method,
      uri,
      nc: this.digest.nc,
      cnonce: this.digest.cnonce,
    });
  }

  /**
   * fetch() mit Drucker-Authentifizierung. Bei Digest wird eine abgelaufene Nonce
   * (401) automatisch mit der neuen Challenge wiederholt.
   */
  async request(pathOrUrl, { method = 'GET', headers = {}, signal, timeoutMs = 4000 } = {}) {
    const url = this.url(pathOrUrl);
    const parsed = new URL(url);
    const uri = `${parsed.pathname}${parsed.search}`;
    const usesLogin = !this.apiKey && this.username && this.password;
    const finalSignal = signal || AbortSignal.timeout(timeoutMs);

    const send = (authorization) => {
      const h = { ...headers };
      if (this.apiKey) h['X-Api-Key'] = this.apiKey;
      if (authorization) h.Authorization = authorization;
      return fetch(url, { method, headers: h, signal: finalSignal });
    };

    let res = await send(usesLogin ? this.authHeader(method, uri) : null);
    if (res.status !== 401 || !usesLogin) return res;

    const wwwAuth = res.headers.get('www-authenticate') || '';
    await res.body?.cancel().catch(() => {});
    const challenge = parseDigestChallenge(wwwAuth);
    if (challenge) {
      // Parallele Anfragen bekommen dieselbe Challenge – dann Zaehler weiterfuehren statt neu starten.
      if (this.digest?.challenge.nonce !== challenge.nonce) {
        this.digest = { challenge, nc: 0, cnonce: crypto.randomBytes(8).toString('hex') };
      }
      res = await send(this.authHeader(method, uri));
    } else if (/^Basic/i.test(wwwAuth)) {
      const basic = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
      res = await send(basic);
    }
    return res;
  }

  async json(pathOrUrl, options) {
    const res = await this.request(pathOrUrl, options);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      const hint = res.status === 401 || res.status === 403 ? ' (Zugangsdaten pruefen)' : '';
      throw new Error(`${pathOrUrl} -> HTTP ${res.status}${hint}`);
    }
    return res.json();
  }
}
