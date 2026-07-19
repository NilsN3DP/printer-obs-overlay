import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadFile, parseFile, computeLive } from './gcode-meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4200);

/**
 * Config priority:
 *   1. CONFIG_PATH env -> JSON file (Unraid: mount /config/config.json)
 *   2. ./config.json next to this file
 *   3. Single printer from env vars PRUSA_HOST / PRUSA_API_KEY (backward compatible)
 */
function loadConfig() {
  const candidates = [];
  if (process.env.CONFIG_PATH) {
    candidates.push(process.env.CONFIG_PATH);
  }
  candidates.push(path.join(__dirname, 'config.json'));

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(parsed.printers) && parsed.printers.length > 0) {
          console.log(`Konfiguration geladen: ${file} (${parsed.printers.length} Drucker)`);
          return normalizeConfig(parsed);
        }
        console.warn(`Konfig ${file} enthaelt keine Drucker, ueberspringe.`);
      }
    } catch (err) {
      console.error(`Konfig ${file} konnte nicht gelesen werden: ${err.message}`);
    }
  }

  // Fallback: single printer from env
  if (process.env.PRUSA_HOST && process.env.PRUSA_API_KEY) {
    console.log('Kein config.json gefunden, nutze einzelnen Drucker aus .env');
    return normalizeConfig({
      pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 2000),
      printers: [
        {
          id: 'default',
          name: process.env.PRUSA_NAME || 'Prusa',
          host: process.env.PRUSA_HOST,
          apiKey: process.env.PRUSA_API_KEY,
        },
      ],
    });
  }

  console.warn(
    '\nKeine Drucker konfiguriert. Lege eine config.json an (siehe config.example.json) ' +
      'oder setze PRUSA_HOST und PRUSA_API_KEY.\n'
  );
  return { pollIntervalMs: 2000, printers: [] };
}

function normalizeConfig(cfg) {
  const pollIntervalMs = Number(cfg.pollIntervalMs || 2000);
  const seen = new Set();
  const printers = (cfg.printers || [])
    .map((p, i) => {
      const id = String(p.id || `printer${i + 1}`).trim();
      return {
        id,
        name: String(p.name || id),
        type: String(p.type || p.provider || cfg.type || 'prusalink').toLowerCase(),
        host: String(p.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
        apiKey: String(p.apiKey || p.api_key || ''),
        // g pro Toolwechsel fuer die Waste-Schaetzung, wenn der Slicer keine
        // Wipe-/Purge-Gramm mitschreibt (0 = Fallback aus)
        wasteGramsPerChange: Number(p.wasteGramsPerChange ?? cfg.wasteGramsPerChange ?? 0) || 0,
      };
    })
    .filter((p) => {
      if (!p.host || (p.type !== 'moonraker' && !p.apiKey)) {
        console.warn(`Drucker "${p.id}" ohne host/apiKey, ignoriert.`);
        return false;
      }
      if (!['prusalink', 'octoprint', 'moonraker'].includes(p.type)) {
        console.warn(`Drucker "${p.id}" mit unbekanntem Typ "${p.type}", ignoriert.`);
        return false;
      }
      if (seen.has(p.id)) {
        console.warn(`Doppelte Drucker-ID "${p.id}", ignoriert.`);
        return false;
      }
      seen.add(p.id);
      return true;
    });
  return { pollIntervalMs, printers };
}

const config = loadConfig();

// Live state per printer id
const states = new Map();
for (const printer of config.printers) {
  states.set(printer.id, {
    connected: false,
    error: 'Noch keine Daten vom Drucker erhalten',
    updatedAt: null,
    printer: null,
    job: null,
  });
}

async function fetchJson(host, apiKey, pathname, headers = {}) {
  const res = await fetch(`http://${host}${pathname}`, {
    headers: { ...headers, ...(apiKey ? { 'X-Api-Key': apiKey } : {}) },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    throw new Error(`${pathname} -> HTTP ${res.status}`);
  }
  return res.json();
}

async function pollPrusaLink(printer) {
  try {
    const [status, job] = await Promise.all([
      fetchJson(printer.host, printer.apiKey, '/api/v1/status'),
      fetchJson(printer.host, printer.apiKey, '/api/v1/job').catch(() => null),
    ]);

    states.set(printer.id, {
      connected: true,
      error: null,
      updatedAt: new Date().toISOString(),
      type: printer.type,
      printer: status.printer ?? null,
      job: job ?? status.job ?? null,
      storage: status.storage ?? null,
    });
  } catch (err) {
    const prev = states.get(printer.id) || {};
    states.set(printer.id, {
      ...prev,
      connected: false,
      type: printer.type,
      error: err.message,
      updatedAt: new Date().toISOString(),
    });
  }
}

function normalizeOctoPrint(printerResp, jobResp) {
  const temps = printerResp.temperature || {};
  const tool0 = temps.tool0 || {};
  const bed = temps.bed || {};
  const state = printerResp.state?.text || jobResp.state || 'Unknown';
  return {
    printer: {
      state: state.toUpperCase().includes('PRINT') ? 'PRINTING' : state.toUpperCase(),
      temp_nozzle: tool0.actual,
      target_nozzle: tool0.target,
      temp_bed: bed.actual,
      target_bed: bed.target,
    },
    job: {
      file: { display_name: jobResp.job?.file?.display || jobResp.job?.file?.name || '—' },
      progress: jobResp.progress?.completion ?? 0,
      time_printing: jobResp.progress?.printTime,
      time_remaining: jobResp.progress?.printTimeLeft,
    },
  };
}

async function pollOctoPrint(printer) {
  try {
    const [printerResp, jobResp] = await Promise.all([
      fetchJson(printer.host, printer.apiKey, '/api/printer'),
      fetchJson(printer.host, printer.apiKey, '/api/job').catch(() => ({})),
    ]);
    const normalized = normalizeOctoPrint(printerResp, jobResp);
    states.set(printer.id, {
      connected: true,
      error: null,
      updatedAt: new Date().toISOString(),
      type: printer.type,
      ...normalized,
    });
  } catch (err) {
    const prev = states.get(printer.id) || {};
    states.set(printer.id, {
      ...prev,
      connected: false,
      type: printer.type,
      error: err.message,
      updatedAt: new Date().toISOString(),
    });
  }
}

function normalizeMoonraker(query) {
  const objects = query.result?.status || query.status || {};
  const extruder = objects.extruder || {};
  const bed = objects.heater_bed || {};
  const printStats = objects.print_stats || {};
  const display = objects.display_status || {};
  const toolhead = objects.toolhead || {};
  return {
    printer: {
      state: String(printStats.state || 'unknown').toUpperCase(),
      temp_nozzle: extruder.temperature,
      target_nozzle: extruder.target,
      temp_bed: bed.temperature,
      target_bed: bed.target,
      axis_z: Array.isArray(toolhead.position) ? toolhead.position[2] : undefined,
    },
    job: {
      file: { display_name: printStats.filename || '—' },
      progress: typeof display.progress === 'number' ? display.progress * 100 : 0,
      time_printing: printStats.print_duration,
      time_remaining: undefined,
    },
  };
}

async function pollMoonraker(printer) {
  try {
    const query =
      '/printer/objects/query?extruder&heater_bed&print_stats&display_status&toolhead';
    const status = await fetchJson(printer.host, printer.apiKey, query);
    states.set(printer.id, {
      connected: true,
      error: null,
      updatedAt: new Date().toISOString(),
      type: printer.type,
      ...normalizeMoonraker(status),
    });
  } catch (err) {
    const prev = states.get(printer.id) || {};
    states.set(printer.id, {
      ...prev,
      connected: false,
      type: printer.type,
      error: err.message,
      updatedAt: new Date().toISOString(),
    });
  }
}

async function pollPrinter(printer) {
  if (printer.type === 'octoprint') return pollOctoPrint(printer);
  if (printer.type === 'moonraker') return pollMoonraker(printer);
  return pollPrusaLink(printer);
}

function pollAll() {
  for (const printer of config.printers) {
    pollPrinter(printer).then(() => {
      if (printer.type === 'prusalink') ensureJobMeta(printer);
    });
  }
}

// G-Code-Metadaten pro Drucker: die gerade druckende Datei wird einmalig via
// PrusaLink (refs.download) geholt und geparst. Liefert Tool/Wechsel/Layer/Waste
// auch ohne Custom-Firmware. Fehler sind nicht fatal – dann fehlen die Felder nur.
const jobMeta = new Map(); // printerId -> { key, meta, fetching, failedAt }

// Geparste Metadaten auf Platte cachen: PrusaLink liefert waehrend eines Drucks
// nur ~15 KB/s, ein Download kann also >10 min dauern – das soll pro Datei nur
// einmal passieren, auch ueber Server-Neustarts hinweg.
const META_CACHE_DIR = process.env.META_CACHE_DIR
  || (process.env.CONFIG_PATH
    ? path.join(path.dirname(process.env.CONFIG_PATH), 'meta-cache')
    : path.join(__dirname, 'config', 'meta-cache'));

function metaCachePath(key) {
  return path.join(META_CACHE_DIR, `${key.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

function readMetaCache(key) {
  try {
    return JSON.parse(fs.readFileSync(metaCachePath(key), 'utf8'));
  } catch {
    return null;
  }
}

function writeMetaCache(key, meta) {
  try {
    fs.mkdirSync(META_CACHE_DIR, { recursive: true });
    fs.writeFileSync(metaCachePath(key), JSON.stringify(meta));
  } catch (err) {
    console.warn(`Meta-Cache konnte nicht geschrieben werden: ${err.message}`);
  }
}

async function ensureJobMeta(printer) {
  const state = states.get(printer.id);
  const file = state?.job?.file;
  const download = file?.refs?.download;
  if (!file || !download) return;

  const key = `${file.name}:${file.size ?? ''}`;
  const entry = jobMeta.get(printer.id);
  if (entry?.fetching) return;
  if (entry?.key === key) {
    // Fehlversuch nach 5 Minuten erneut probieren
    if (entry.meta || !entry.failedAt || Date.now() - entry.failedAt < 5 * 60 * 1000) return;
  }

  const cached = readMetaCache(key);
  if (cached) {
    jobMeta.set(printer.id, { key, meta: cached });
    console.log(`[${printer.id}] Meta aus Disk-Cache: ${file.display_name || file.name}`);
    return;
  }

  jobMeta.set(printer.id, { key, fetching: true });
  try {
    console.log(`[${printer.id}] Lade G-Code fuer Overlay-Meta: ${file.display_name || file.name}`);
    const buf = await downloadFile(printer.host, printer.apiKey, download);
    const meta = parseFile(buf);
    jobMeta.set(printer.id, { key, meta });
    writeMetaCache(key, meta);
    console.log(
      `[${printer.id}] Meta ok: ${meta.changesTotal} Wechsel, ${meta.layerTotal} Layer, `
        + `${meta.toolsTotal ?? '?'} Tools, ${Math.round(buf.length / 1024)} KiB`
    );
  } catch (err) {
    console.error(`[${printer.id}] G-Code-Meta fehlgeschlagen: ${err.message}`);
    jobMeta.set(printer.id, { key, meta: null, failedAt: Date.now() });
  }
}

/** Firmware-Felder haben Vorrang; fehlende Werte kommen aus den G-Code-Metadaten. */
function enrichState(printerId, state) {
  const meta = jobMeta.get(printerId)?.meta;
  if (!meta || !state?.printer || !state.job) return state;
  const printerCfg = config.printers.find((p) => p.id === printerId);
  const derived = computeLive(meta, typeof state.job.progress === 'number' ? state.job.progress : null, {
    wasteGramsPerChange: printerCfg?.wasteGramsPerChange,
  });
  const printer = { ...state.printer };
  for (const [k, v] of Object.entries(derived)) {
    if (printer[k] === undefined || printer[k] === null) printer[k] = v;
  }
  return { ...state, printer };
}

pollAll();
setInterval(pollAll, config.pollIntervalMs);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  const printers = config.printers.map((p) => {
    const state = enrichState(p.id, states.get(p.id));
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      host: p.host,
      connected: Boolean(state?.connected),
      state: state?.printer?.state || null,
      file: state?.job?.file?.display_name || state?.job?.file?.name || null,
      progress: typeof state?.job?.progress === 'number' ? state.job.progress : null,
      updatedAt: state?.updatedAt || null,
      error: state?.error || null,
    };
  });
  res.json({
    ok: true,
    version: process.env.npm_package_version || '1.0.0',
    pollIntervalMs: config.pollIntervalMs,
    printers,
  });
});

// List configured printers (id + name only, never the API key)
app.get('/api/printers', (req, res) => {
  res.json(config.printers.map((p) => ({ id: p.id, name: p.name, type: p.type })));
});

// Status for one printer (defaults to the first configured printer)
app.get('/api/status', (req, res) => {
  const id = req.query.printer || config.printers[0]?.id;
  if (!id || !states.has(id)) {
    res.status(404).json({ connected: false, error: `Unbekannter Drucker: ${id ?? '(keiner)'}` });
    return;
  }
  res.json(enrichState(id, states.get(id)));
});

app.listen(PORT, () => {
  console.log(`Prusa OBS Overlay Server laeuft auf http://localhost:${PORT}`);
  console.log(`Konfig-Oberflaeche:  http://localhost:${PORT}/`);
  console.log(`Overlay (direkt):    http://localhost:${PORT}/overlay.html`);
  if (config.printers.length) {
    console.log('Drucker:');
    for (const p of config.printers) {
      console.log(`  - ${p.id} (${p.name}) -> ${p.host}`);
    }
  }
});
