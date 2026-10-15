// Verdrahtet Konfiguration, Abfrage-Schleife und HTTP-API zu einem Server.
import http from 'node:http';
import { modelById } from './config/models.js';
import { discover, localSubnets, subnetOf } from './discovery.js';
import { serveAsset } from './http/assets.js';
import { HttpError, createRouter, readBody, readJson, sendJson } from './http/router.js';
import { autostart } from './platform/system.js';
import { normalizePrinter } from './config/store.js';
import { parseFile, summarizeMeta } from './telemetry/gcode/parse.js';

const UPLOAD_LIMIT = 300 * 1024 * 1024;
const HEARTBEAT_MS = 15_000;

/**
 * @param {{runtime: object, store: import('./config/store.js').ConfigStore,
 *          poller: import('./telemetry/poller.js').Poller, logger: Console}} deps
 */
export function createApp({ runtime, store, poller, logger }) {
  const router = createRouter();
  const publicBaseUrl = () => runtime.publicBaseUrl || store.config.publicBaseUrl || '';
  const defaultPrinterId = () => store.printers[0]?.id;

  const printerSummary = (p) => {
    const s = poller.snapshot(p.id) || {};
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      model: p.model,
      capabilities: modelById(p.model),
      host: p.host,
      presetId: p.presetId,
      virtual: p.type === 'demo',
      connected: Boolean(s.connected),
      state: s.printer?.swap_in_progress ? 'SWAPPING' : s.printer?.state || null,
      file: s.job?.file?.display_name || s.job?.file?.name || null,
      progress: typeof s.job?.progress === 'number' ? s.job.progress : null,
      timeRemaining: s.job?.time_remaining ?? null,
      meta: s.meta || null,
      error: s.error || null,
      updatedAt: s.updatedAt || null,
    };
  };

  router.get('/api/health', (req, res) => {
    sendJson(res, 200, {
      ok: true,
      app: 'printer-obs-overlay',
      version: runtime.version,
      mode: runtime.mode,
      pollIntervalMs: store.config.pollIntervalMs,
      printers: store.printers.map(printerSummary),
    });
  });

  router.get('/api/printers', (req, res) => {
    sendJson(res, 200, store.printers.map((p) => ({
      id: p.id, name: p.name, type: p.type, model: p.model, capabilities: modelById(p.model), presetId: p.presetId,
    })));
  });

  router.get('/api/status', (req, res, url) => {
    const id = url.searchParams.get('printer') || defaultPrinterId();
    const snapshot = id && poller.snapshot(id);
    if (!snapshot) throw new HttpError(404, `Unbekannter Drucker: ${id ?? '(keiner konfiguriert)'}`);
    sendJson(res, 200, snapshot);
  });

  // Server-Sent Events: das Overlay bekommt jede Aktualisierung sofort geschoben.
  router.get('/api/stream', (req, res, url) => {
    const id = url.searchParams.get('printer') || defaultPrinterId();
    if (!id || !store.printer(id)) throw new HttpError(404, `Unbekannter Drucker: ${id ?? '(keiner)'}`);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const push = (changedId) => {
      if (changedId !== id) return;
      const snapshot = poller.snapshot(id);
      if (snapshot) res.write(`event: status\ndata: ${JSON.stringify(snapshot)}\n\n`);
    };
    const pushConfig = () => res.write('event: config\ndata: {}\n\n');
    res.write(`retry: 3000\n\n`);
    push(id);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    poller.on('update', push);
    store.on('change', pushConfig);
    req.on('close', () => {
      clearInterval(heartbeat);
      poller.off('update', push);
      store.off('change', pushConfig);
    });
  });

  router.get('/api/config', (req, res) => {
    sendJson(res, 200, {
      ...store.publicConfig(),
      effectivePublicBaseUrl: publicBaseUrl(),
      publicBaseUrlFromEnv: Boolean(runtime.publicBaseUrl),
    });
  });

  router.put('/api/config', async (req, res) => {
    const body = await readJson(req);
    const result = store.update(body);
    sendJson(res, 200, { ...result, effectivePublicBaseUrl: publicBaseUrl(), publicBaseUrlFromEnv: Boolean(runtime.publicBaseUrl) });
  });

  router.post('/api/printers/test', async (req, res) => {
    const body = await readJson(req);
    const existing = store.config.printers.find((p) => p.id === (body.originalId || body.id));
    const printer = normalizePrinter({
      ...body,
      apiKey: body.apiKey || existing?.apiKey || '',
      password: body.password || existing?.password || '',
    });
    sendJson(res, 200, await poller.test(printer));
  });

  router.post('/api/analyze', async (req, res) => {
    const buf = await readBody(req, UPLOAD_LIMIT);
    if (!buf.length) throw new HttpError(400, 'Keine Datei empfangen');
    const name = decodeURIComponent(String(req.headers['x-filename'] || 'upload'));
    try {
      sendJson(res, 200, { ok: true, ...summarizeMeta(parseFile(buf), name) });
    } catch (err) {
      throw new HttpError(422, `Datei konnte nicht gelesen werden: ${err.message}`);
    }
  });

  router.get('/api/discover/subnets', (req, res) => {
    const fromClient = subnetOf(req.socket.remoteAddress);
    const all = [...new Set([fromClient, ...localSubnets()].filter(Boolean))];
    sendJson(res, 200, { subnets: all });
  });

  router.get('/api/discover', async (req, res, url) => {
    const cidr = url.searchParams.get('cidr') || subnetOf(req.socket.remoteAddress) || localSubnets()[0];
    try {
      sendJson(res, 200, { ok: true, cidr, found: await discover(cidr) });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  router.get('/api/system', async (req, res) => {
    sendJson(res, 200, {
      version: runtime.version,
      mode: runtime.mode,
      platform: runtime.platform,
      dataDir: runtime.dataDir,
      configFile: store.configFile,
      port: runtime.port,
      host: runtime.host,
      autostart: { supported: autostart.supported(), enabled: await autostart.enabled() },
      canShutdown: runtime.mode === 'app',
    });
  });

  router.put('/api/system/autostart', async (req, res) => {
    const body = await readJson(req);
    sendJson(res, 200, { ok: true, enabled: await autostart.set(Boolean(body.enabled)) });
  });

  router.post('/api/system/shutdown', async (req, res) => {
    if (runtime.mode !== 'app') throw new HttpError(403, 'Nur in der Windows-App verfügbar');
    sendJson(res, 200, { ok: true });
    logger.log('Beenden über das Dashboard angefordert');
    setTimeout(() => process.exit(0), 300);
  });

  // Kompakte Liste fuer die Eigenschaften der OBS-Quelle (vom Plugin per obs_data gelesen).
  router.get('/api/obs/options', (req, res) => {
    sendJson(res, 200, {
      version: runtime.version,
      printers: store.printers.map((p) => ({ id: p.id, name: p.name })),
      presets: store.config.presets.map((p) => ({ id: p.id, name: p.name })),
    });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (await router.handle(req, res, url)) return;
      if (serveAsset(req, res, url)) return;
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'Unbekannter Endpunkt' });
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden');
    } catch (err) {
      logger.error(err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Interner Fehler' });
    }
  });
  server.keepAliveTimeout = 65_000;
  return server;
}
