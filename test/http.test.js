import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/app.js';
import { ConfigStore } from '../src/server/config/store.js';
import { runtime } from '../src/server/runtime.js';
import { Enricher } from '../src/server/telemetry/enrich.js';
import { JobMetaService } from '../src/server/telemetry/job-meta.js';
import { Poller } from '../src/server/telemetry/poller.js';

const quiet = { log() {}, error() {}, warn() {} };

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-http-'));
  const store = new ConfigStore({ configFile: path.join(dir, 'config.json'), env: {}, logger: quiet }).load();
  const metaService = new JobMetaService({ cacheDir: path.join(dir, 'cache'), logger: quiet });
  const poller = new Poller({ store, metaService, enricher: new Enricher({ metaService, globalWaste: () => 0 }) });
  const server = createApp({ runtime: { ...runtime, mode: 'dev', publicBaseUrl: '' }, store, poller, logger: quiet });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  poller.start();
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => { poller.stop(); server.closeAllConnections(); server.close(); },
  };
}

test('HTTP-API und Weboberfläche', async (t) => {
  const srv = await startServer();
  t.after(srv.close);

  await t.test('health listet den Demo-Drucker', async () => {
    const health = await fetch(`${srv.base}/api/health`).then((r) => r.json());
    assert.equal(health.app, 'printer-obs-overlay');
    assert.equal(health.printers[0].id, 'demo');
  });

  await t.test('status liefert angereicherte Demo-Daten', async () => {
    const status = await fetch(`${srv.base}/api/status?printer=demo`).then((r) => r.json());
    assert.equal(status.connected, true);
    assert.ok(status.printer);
  });

  await t.test('unbekannter Drucker -> 404', async () => {
    const res = await fetch(`${srv.base}/api/status?printer=gibtsnicht`);
    assert.equal(res.status, 404);
  });

  await t.test('Dashboard und Overlay werden ausgeliefert', async () => {
    for (const p of ['/', '/overlay.html', '/overlay', '/dashboard/main.js', '/shared/sections.js']) {
      const res = await fetch(`${srv.base}${p}`);
      assert.equal(res.status, 200, p);
      await res.arrayBuffer();
    }
    const traversal = await fetch(`${srv.base}/..%2f..%2fpackage.json`);
    assert.equal(traversal.status, 404);
  });

  await t.test('Konfiguration speichern verlangt JSON und gleiche Herkunft', async () => {
    const noJson = await fetch(`${srv.base}/api/config`, { method: 'PUT', body: '{}' });
    assert.equal(noJson.status, 415);
    const foreign = await fetch(`${srv.base}/api/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{}',
    });
    assert.equal(foreign.status, 403);
    const ok = await fetch(`${srv.base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demoMode: true, presets: [{ name: 'Karte', layout: 'card', sections: ['time'] }] }),
    }).then((r) => r.json());
    assert.equal(ok.presets[0].id, 'karte');
  });

  await t.test('Stream sendet Status als Server-Sent Event', async () => {
    const controller = new AbortController();
    const res = await fetch(`${srv.base}/api/stream?printer=demo`, { signal: controller.signal });
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    let text = '';
    while (!text.includes('event: status')) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
  });

  await t.test('Datei-Analyse per Upload', async () => {
    const body = 'M73 P0 R10\nT0\nM73 P50 R5\nT1\n; total toolchanges = 1\n';
    const res = await fetch(`${srv.base}/api/analyze`, { method: 'POST', headers: { 'X-Filename': 'a.gcode' }, body });
    const data = await res.json();
    assert.equal(data.changesTotal, 1);
  });
});
