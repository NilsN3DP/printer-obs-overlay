import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { PrinterClient, parseDigestChallenge } from '../src/server/printers/client.js';
import { demoStatus } from '../src/server/printers/demo.js';
import { normalizeMoonraker } from '../src/server/printers/moonraker.js';
import { normalizeOctoPrint } from '../src/server/printers/octoprint.js';
import { pollPrusaLink } from '../src/server/printers/prusalink.js';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

/** Minimaler PrusaLink-Nachbau mit Digest-Login (wie die Buddy-Firmware). */
function mockPrusaLink({ user = 'maker', pass = 'secret', job = null } = {}) {
  const state = { nonce: 'n1', requests: 0, ncSeen: [] };
  const server = http.createServer((req, res) => {
    state.requests++;
    const auth = req.headers.authorization || '';
    const fields = Object.fromEntries([...auth.matchAll(/(\w+)="?([^",]*)"?/g)].map((m) => [m[1], m[2]]));
    const ha1 = md5(`${user}:Printer API:${pass}`);
    const ha2 = md5(`${req.method}:${fields.uri}`);
    const expected = md5(`${ha1}:${state.nonce}:${fields.nc}:${fields.cnonce}:auth:${ha2}`);
    if (!auth.startsWith('Digest') || fields.nonce !== state.nonce || fields.response !== expected) {
      res.writeHead(401, { 'WWW-Authenticate': `Digest realm="Printer API", nonce="${state.nonce}", qop="auth"` });
      return res.end();
    }
    state.ncSeen.push(`${fields.cnonce}:${fields.nc}`);
    if (req.url === '/api/v1/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ printer: { state: job ? 'PRINTING' : 'IDLE', temp_nozzle: 215 } }));
    }
    if (req.url === '/api/v1/job') {
      if (!job) { res.writeHead(204); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(job));
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, host: `127.0.0.1:${server.address().port}` })));
}

test('Digest-Challenge wird gelesen', () => {
  const c = parseDigestChallenge('Digest realm="Printer API", nonce="abc", qop="auth", algorithm=MD5');
  assert.equal(c.realm, 'Printer API');
  assert.equal(c.nonce, 'abc');
  assert.equal(parseDigestChallenge('Basic realm="x"'), null);
});

test('PrusaLink mit Digest-Login, Nonce-Wechsel und leerem Job (204)', async () => {
  const mock = await mockPrusaLink();
  try {
    const client = new PrinterClient({ host: mock.host, username: 'maker', password: 'secret' });
    const first = await pollPrusaLink(client);
    assert.equal(first.printer.state, 'IDLE');
    assert.equal(first.job, null);

    // Gecachte Challenge: keine weiteren 401-Runden, nc zaehlt hoch.
    const before = mock.state.requests;
    await pollPrusaLink(client);
    assert.equal(mock.state.requests - before, 2);
    assert.equal(new Set(mock.state.ncSeen).size, mock.state.ncSeen.length);

    // Drucker vergibt neue Nonce -> Client holt sich die neue Challenge selbst.
    mock.state.nonce = 'n2';
    const again = await pollPrusaLink(client);
    assert.equal(again.printer.temp_nozzle, 215);
  } finally {
    mock.server.close();
  }
});

test('PrusaLink liefert laufenden Job', async () => {
  const mock = await mockPrusaLink({ job: { progress: 42, file: { display_name: 'a.bgcode' } } });
  try {
    const status = await pollPrusaLink(new PrinterClient({ host: mock.host, username: 'maker', password: 'secret' }));
    assert.equal(status.printer.state, 'PRINTING');
    assert.equal(status.job.progress, 42);
  } finally {
    mock.server.close();
  }
});

test('Falsches Passwort bleibt bei 401', async () => {
  const mock = await mockPrusaLink();
  try {
    const client = new PrinterClient({ host: mock.host, username: 'maker', password: 'falsch' });
    await assert.rejects(client.json('/api/v1/status'), /401/);
  } finally {
    mock.server.close();
  }
});

test('OctoPrint wird ins gemeinsame Format übersetzt', () => {
  const s = normalizeOctoPrint(
    { state: { text: 'Printing' }, temperature: { tool0: { actual: 210, target: 215 }, bed: { actual: 60, target: 60 } } },
    { job: { file: { name: 'teil.gcode' } }, progress: { completion: 12.5, printTime: 100, printTimeLeft: 700 } },
  );
  assert.equal(s.printer.state, 'PRINTING');
  assert.equal(s.printer.target_nozzle, 215);
  assert.equal(s.job.progress, 12.5);
  assert.equal(s.job.time_remaining, 700);
});

test('Moonraker wird ins gemeinsame Format übersetzt', () => {
  const s = normalizeMoonraker({
    result: {
      status: {
        extruder: { temperature: 240, target: 240 },
        heater_bed: { temperature: 100, target: 100 },
        print_stats: { state: 'printing', filename: 'x.gcode', print_duration: 600, info: { current_layer: 5, total_layer: 50 } },
        display_status: { progress: 0.25 },
        gcode_move: { speed_factor: 1.5, extrude_factor: 0.98 },
        fan: { speed: 0.4 },
        toolhead: { position: [0, 0, 12.4, 0] },
      },
    },
  });
  assert.equal(s.printer.state, 'PRINTING');
  assert.equal(s.printer.speed, 150);
  assert.equal(s.printer.flow, 98);
  assert.equal(s.printer.fan_print_pct, 40);
  assert.equal(s.printer.axis_z, 12.4);
  assert.equal(s.printer.layer_total, 50);
  assert.equal(s.job.progress, 25);
  assert.equal(s.job.time_remaining, 1800);
});

test('Demo-Drucker liefert vollständige Daten', () => {
  const s = demoStatus(0);
  assert.ok(s.printer.state);
  assert.ok(s.job?.file?.display_name);
  assert.equal(typeof s.job.progress, 'number');
});
