import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore, normalizeConfig } from '../src/server/config/store.js';

const quiet = { log() {}, error() {} };

function tempStore(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-config-'));
  const configFile = path.join(dir, 'config.json');
  if (initial !== undefined) fs.writeFileSync(configFile, typeof initial === 'string' ? initial : JSON.stringify(initial));
  return { dir, configFile, store: new ConfigStore({ configFile, env: {}, logger: quiet }).load() };
}

test('Erster Start legt Konfiguration mit Demo-Drucker an', () => {
  const { store, configFile } = tempStore();
  assert.ok(fs.existsSync(configFile));
  assert.equal(store.config.demoMode, true);
  assert.deepEqual(store.printers.map((p) => p.id), ['demo']);
});

test('Kaputte config.json wird gesichert statt überschrieben', () => {
  const { dir, store } = tempStore('{ kaputt');
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.broken-')));
  assert.equal(store.config.printers.length, 0);
});

test('v1-Konfiguration wird übernommen', () => {
  const cfg = normalizeConfig({
    pollIntervalMs: 1000,
    theme: { brandText: 'Kanal_de', socials: { youtube: 'visible', instagram: 'visible' } },
    printers: [{ id: 'Core One INDX', host: 'http://10.0.0.5/', api_key: 'abc' }],
  });
  assert.equal(cfg.printers[0].id, 'core-one-indx');
  assert.equal(cfg.printers[0].model, 'coreone-indx');
  assert.equal(cfg.printers[0].host, '10.0.0.5');
  assert.equal(cfg.printers[0].apiKey, 'abc');
  assert.deepEqual(cfg.theme.socials, ['youtube', 'instagram']);
});

test('Zugangsdaten: nie ausgeliefert, leer = behalten, null = löschen', () => {
  const { store, configFile } = tempStore({
    printers: [{ id: 'p1', name: 'P1', host: '10.0.0.2', username: 'maker', password: 'geheim', apiKey: 'key' }],
  });
  const pub = store.publicConfig();
  assert.equal(JSON.stringify(pub).includes('geheim'), false);
  assert.equal(pub.printers[0].passwordSet, true);

  store.update({ printers: [{ ...pub.printers[0], name: 'Neu', password: '', apiKey: undefined }] });
  assert.equal(store.config.printers[0].name, 'Neu');
  assert.equal(store.config.printers[0].password, 'geheim');
  assert.equal(store.config.printers[0].apiKey, 'key');

  store.update({ printers: [{ ...pub.printers[0], apiKey: null }] });
  assert.equal(store.config.printers[0].apiKey, '');
  assert.equal(store.config.printers[0].password, 'geheim');

  const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(saved.printers[0].password, 'geheim');
});

test('Umbenannte ID behält Zugangsdaten über originalId', () => {
  const { store } = tempStore({ printers: [{ id: 'alt', host: '10.0.0.2', username: 'maker', password: 'pw' }] });
  store.update({ printers: [{ id: 'neu', originalId: 'alt', host: '10.0.0.2', username: 'maker' }] });
  assert.equal(store.config.printers[0].id, 'neu');
  assert.equal(store.config.printers[0].password, 'pw');
});

test('Änderungen an der Datei von außen werden übernommen', async () => {
  const { store, configFile } = tempStore({ pollIntervalMs: 2000 });
  store.watch(50);
  try {
    const changed = new Promise((resolve) => store.once('change', resolve));
    await new Promise((r) => setTimeout(r, 120));
    fs.writeFileSync(configFile, JSON.stringify({ pollIntervalMs: 5000 }));
    await changed;
    assert.equal(store.config.pollIntervalMs, 5000);
  } finally {
    store.unwatch();
  }
});

test('Grenzwerte und doppelte IDs werden bereinigt', () => {
  const cfg = normalizeConfig({
    pollIntervalMs: 10,
    printers: [{ id: 'a', host: 'x' }, { id: 'a', host: 'y' }, { id: 'demo', type: 'demo' }],
    presets: [{ name: 'Nur Zeit', layout: 'card', sections: ['time'] }, { name: 'Nur Zeit' }],
  });
  assert.equal(cfg.pollIntervalMs, 500);
  assert.deepEqual(cfg.printers.map((p) => p.id), ['a', 'a-2']);
  assert.equal(cfg.presets.length, 1);
  assert.equal(cfg.presets[0].id, 'nur-zeit');
});

test('Ersteinrichtung: neu = offen, alte Konfiguration mit Druckern = erledigt', () => {
  assert.equal(normalizeConfig({}).setupDone, false);
  assert.equal(normalizeConfig({ printers: [{ id: 'a', host: 'x' }] }).setupDone, true);
  assert.equal(normalizeConfig({ setupDone: true }).setupDone, true);
  assert.equal(normalizeConfig({}).theme.brandText, '');
  assert.deepEqual(normalizeConfig({}).theme.socials, []);
});

test('Toolchanger-Funktionen sind aus, bis sie bewusst eingeschaltet werden', () => {
  const withIndx = normalizeConfig({ printers: [{ id: 'indx', host: 'x', model: 'coreone-indx' }] });
  assert.equal(withIndx.toolchangerEnabled, false);
  assert.equal(normalizeConfig({ toolchangerEnabled: true }).toolchangerEnabled, true);
});
