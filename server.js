import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { downloadFile, parseFile, computeLive } from './gcode-meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4200);
const PACKAGE_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return process.env.npm_package_version || '0.0.0';
  }
})();

const PRINTER_MODELS = [
  { id: 'custom', name: 'Anderer Drucker', board: 'other', toolchanger: false, indx: false, xl: false },
  { id: 'mini', name: 'Prusa MINI / MINI+', board: 'xBuddy', toolchanger: false, indx: false, xl: false },
  { id: 'mk35', name: 'Prusa MK3.5', board: 'xBuddy', toolchanger: false, indx: false, xl: false },
  { id: 'mk4', name: 'Prusa MK4', board: 'xBuddy', toolchanger: false, indx: false, xl: false },
  { id: 'mk4s', name: 'Prusa MK4S', board: 'xBuddy', toolchanger: false, indx: false, xl: false },
  { id: 'coreone', name: 'Prusa Core One', board: 'xBuddy', toolchanger: false, indx: false, xl: false },
  { id: 'coreone-indx', name: 'Prusa Core One INDX', board: 'xBuddy', toolchanger: true, indx: true, xl: false },
  { id: 'xl-1t', name: 'Prusa XL 1 Tool', board: 'xBuddy', toolchanger: false, indx: false, xl: true },
  { id: 'xl-2t', name: 'Prusa XL 2 Tool', board: 'xBuddy', toolchanger: true, indx: false, xl: true },
  { id: 'xl-5t', name: 'Prusa XL 5 Tool', board: 'xBuddy', toolchanger: true, indx: false, xl: true },
];

function modelCapabilities(modelId) {
  return PRINTER_MODELS.find((m) => m.id === modelId) || PRINTER_MODELS[0];
}

function inferModel(p) {
  if (p.model || p.printerModel) return String(p.model || p.printerModel);
  const text = `${p.id || ''} ${p.name || ''}`.toLowerCase();
  if (text.includes('xl') && text.includes('5')) return 'xl-5t';
  if (text.includes('xl') && text.includes('2')) return 'xl-2t';
  if (text.includes('xl')) return 'xl-1t';
  if (text.includes('indx')) return 'coreone-indx';
  if (text.includes('core') && text.includes('one')) return 'coreone';
  if (text.includes('mk4s')) return 'mk4s';
  if (text.includes('mk4')) return 'mk4';
  if (text.includes('mk3.5') || text.includes('mk35')) return 'mk35';
  if (text.includes('mini')) return 'mini';
  return 'custom';
}

const CONFIG_CANDIDATES = [
  ...(process.env.CONFIG_PATH ? [process.env.CONFIG_PATH] : []),
  path.join(__dirname, 'config.json'),
];

function writableConfigFile() {
  return process.env.CONFIG_PATH || path.join(__dirname, 'config.json');
}

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
          return { config: normalizeConfig(parsed), source: file, raw: parsed };
        }
        console.warn(`Konfig ${file} enthaelt keine Drucker, ueberspringe.`);
      }
    } catch (err) {
      console.error(`Konfig ${file} konnte nicht gelesen werden: ${err.message}`);
    }
  }

  // Fallback: single printer from env
  if (process.env.PRUSA_HOST && (process.env.PRUSA_API_KEY || (process.env.PRUSA_USERNAME && process.env.PRUSA_PASSWORD))) {
    console.log('Kein config.json gefunden, nutze einzelnen Drucker aus .env');
    const raw = {
      pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 2000),
      printers: [
        {
          id: 'default',
          name: process.env.PRUSA_NAME || 'Prusa',
          host: process.env.PRUSA_HOST,
          apiKey: process.env.PRUSA_API_KEY || '',
          username: process.env.PRUSA_USERNAME || '',
          password: process.env.PRUSA_PASSWORD || '',
        },
      ],
    };
    return { config: normalizeConfig(raw), source: null, raw };
  }

  console.warn(
    '\nKeine Drucker konfiguriert. Lege eine config.json an (siehe config.example.json) ' +
      'oder setze PRUSA_HOST und PRUSA_API_KEY.\n'
  );
  const raw = { pollIntervalMs: 2000, demoMode: true, printers: [] };
  return { config: normalizeConfig(raw), source: null, raw };
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
        model: inferModel(p),
        host: String(p.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
        apiKey: String(p.apiKey || p.api_key || ''),
        username: String(p.username || p.user || ''),
        password: String(p.password || ''),
        cameraUrl: String(p.cameraUrl || ''),
        // g pro Toolwechsel fuer die Waste-Schaetzung, wenn der Slicer keine
        // Wipe-/Purge-Gramm mitschreibt (0 = Fallback aus)
        wasteGramsPerChange: Number(p.wasteGramsPerChange ?? cfg.wasteGramsPerChange ?? 0) || 0,
      };
    })
    .filter((p) => {
      const hasPrusaAuth = p.apiKey || (p.username && p.password);
      const hasAuth = p.type === 'moonraker' || p.type === 'demo'
        || (p.type === 'prusalink' ? hasPrusaAuth : p.apiKey);
      if (p.type !== 'demo' && (!p.host || !hasAuth)) {
        console.warn(`Drucker "${p.id}" ohne host/auth, ignoriert.`);
        return false;
      }
      if (!['prusalink', 'octoprint', 'moonraker', 'demo'].includes(p.type)) {
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
  if (cfg.demoMode && !printers.some((p) => p.id === 'demo')) {
    printers.push({
      id: 'demo',
      name: 'Demo Drucker',
      type: 'demo',
      host: '',
      apiKey: '',
      username: '',
      password: '',
      cameraUrl: '',
      model: 'coreone-indx',
      wasteGramsPerChange: 0.022,
    });
  }
  return {
    pollIntervalMs,
    demoMode: Boolean(cfg.demoMode),
    theme: normalizeTheme(cfg.theme),
    presets: normalizePresets(cfg.presets),
    printers,
  };
}

function normalizeTheme(theme = {}) {
  const socials = theme.socials && typeof theme.socials === 'object' ? theme.socials : {};
  return {
    accentColor: String(theme.accentColor || '#fa6831'),
    brandText: String(theme.brandText || 'N3DP_de'),
    logoUrl: String(theme.logoUrl || ''),
    socials: {
      youtube: String(socials.youtube || ''),
      instagram: String(socials.instagram || ''),
      tiktok: String(socials.tiktok || ''),
      twitch: String(socials.twitch || ''),
      website: String(socials.website || ''),
    },
  };
}

function normalizePresets(presets = []) {
  return Array.isArray(presets)
    ? presets.map((p, i) => ({
      id: String(p.id || `preset${i + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase(),
      name: String(p.name || `Preset ${i + 1}`),
      layout: p.layout === 'card' ? 'card' : 'bar',
      sections: Array.isArray(p.sections) ? p.sections.map(String) : [],
      accentColor: String(p.accentColor || ''),
      brandText: String(p.brandText || ''),
      socials: Array.isArray(p.socials) ? p.socials.map(String) : [],
    })).filter((p) => p.id && p.sections.length > 0)
    : [];
}

function publicConfig() {
  return {
    source: configSource,
    writablePath: writableConfigFile(),
    pollIntervalMs: config.pollIntervalMs,
    demoMode: config.demoMode,
    theme: config.theme,
    presets: config.presets,
    printerModels: PRINTER_MODELS,
    printers: config.printers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      model: p.model || 'custom',
      capabilities: modelCapabilities(p.model),
      host: p.host,
      apiKeySet: Boolean(p.apiKey),
      username: p.username || '',
      passwordSet: Boolean(p.password),
      cameraUrl: p.cameraUrl || '',
      wasteGramsPerChange: p.wasteGramsPerChange,
    })),
  };
}

function persistConfig(nextPublic) {
  const currentById = new Map(config.printers.map((p) => [p.id, p]));
  const raw = {
    pollIntervalMs: Number(nextPublic.pollIntervalMs || config.pollIntervalMs || 2000),
    demoMode: Boolean(nextPublic.demoMode),
    theme: normalizeTheme(nextPublic.theme),
    presets: normalizePresets(nextPublic.presets),
    printers: (nextPublic.printers || [])
      .filter((p) => p.type !== 'demo')
      .map((p, i) => {
        const id = String(p.id || `printer${i + 1}`).trim();
        const existing = currentById.get(id);
        const apiKey = p.apiKey && p.apiKey !== '__KEEP__' ? String(p.apiKey) : existing?.apiKey || '';
        const password = p.password && p.password !== '__KEEP__' ? String(p.password) : existing?.password || '';
        return {
          id,
          name: String(p.name || id),
          type: String(p.type || 'prusalink').toLowerCase(),
          model: String(p.model || 'custom'),
          host: String(p.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
          apiKey,
          username: String(p.username || ''),
          password,
          cameraUrl: String(p.cameraUrl || ''),
          wasteGramsPerChange: Number(p.wasteGramsPerChange || 0),
        };
      }),
  };
  const normalized = normalizeConfig(raw);
  fs.mkdirSync(path.dirname(writableConfigFile()), { recursive: true });
  fs.writeFileSync(writableConfigFile(), `${JSON.stringify(raw, null, 2)}\n`);
  config = normalized;
  configSource = writableConfigFile();
  reconcileStates();
  return publicConfig();
}

let loaded = loadConfig();
let config = loaded.config;
let configSource = loaded.source;

// Live state per printer id
const states = new Map();
function initialState(type) {
  return {
    connected: false,
    type,
    error: 'Noch keine Daten vom Drucker erhalten',
    updatedAt: null,
    printer: null,
    job: null,
  };
}

function reconcileStates() {
  const ids = new Set(config.printers.map((p) => p.id));
  for (const id of [...states.keys()]) {
    if (!ids.has(id)) states.delete(id);
  }
  for (const printer of config.printers) {
    if (!states.has(printer.id)) states.set(printer.id, initialState(printer.type));
  }
}
reconcileStates();

function printerAuthHeaders(printer, headers = {}) {
  const next = { ...headers };
  if (printer?.apiKey) {
    next['X-Api-Key'] = printer.apiKey;
  } else if (printer?.username && printer?.password) {
    next.Authorization = `Basic ${Buffer.from(`${printer.username}:${printer.password}`).toString('base64')}`;
  }
  return next;
}

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function parseDigestChallenge(header) {
  if (!header || !/^Digest\s/i.test(header)) return null;
  const fields = {};
  const body = header.replace(/^Digest\s+/i, '');
  const re = /(\w+)=("([^"]*)"|([^,]*))(?:,\s*|$)/g;
  let match;
  while ((match = re.exec(body))) {
    fields[match[1]] = match[3] ?? match[4] ?? '';
  }
  return fields.realm && fields.nonce ? fields : null;
}

function digestAuthHeader(printer, challenge, method, uri) {
  const qop = String(challenge.qop || '').split(',').map((v) => v.trim()).includes('auth') ? 'auth' : '';
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const algorithm = String(challenge.algorithm || 'MD5').toUpperCase();
  const ha1Base = md5(`${printer.username}:${challenge.realm}:${printer.password}`);
  const ha1 = algorithm === 'MD5-SESS' ? md5(`${ha1Base}:${challenge.nonce}:${cnonce}`) : ha1Base;
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${printer.username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

async function fetchWithPrinterAuth(printer, pathnameOrUrl, options = {}) {
  const isAbsolute = /^https?:\/\//i.test(pathnameOrUrl);
  const url = isAbsolute ? pathnameOrUrl : `http://${printer.host}${pathnameOrUrl}`;
  const parsed = new URL(url);
  const uri = `${parsed.pathname}${parsed.search}`;
  const method = String(options.method || 'GET').toUpperCase();
  const headers = printerAuthHeaders(printer, options.headers || {});
  const first = await fetch(url, { ...options, method, headers });
  if (
    first.status !== 401
    || printer.apiKey
    || !printer.username
    || !printer.password
    || !first.headers.get('www-authenticate')?.includes('Digest')
  ) {
    return first;
  }
  first.body?.cancel?.().catch?.(() => {});
  const challenge = parseDigestChallenge(first.headers.get('www-authenticate'));
  if (!challenge) return first;
  const digestHeaders = {
    ...(options.headers || {}),
    Authorization: digestAuthHeader(printer, challenge, method, uri),
  };
  return fetch(url, { ...options, method, headers: digestHeaders });
}

async function fetchJson(printer, pathname, headers = {}) {
  const res = await fetchWithPrinterAuth(printer, pathname, {
    headers,
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
      fetchJson(printer, '/api/v1/status'),
      fetchJson(printer, '/api/v1/job').catch(() => null),
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
      fetchJson(printer, '/api/printer'),
      fetchJson(printer, '/api/job').catch(() => ({})),
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
    const status = await fetchJson(printer, query);
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

async function pollDemo(printer) {
  const seconds = Math.floor(Date.now() / 1000);
  const progress = (seconds % 600) / 6;
  const tool = Math.floor(progress / 20) % 5;
  states.set(printer.id, {
    connected: true,
    error: null,
    updatedAt: new Date().toISOString(),
    type: printer.type,
    printer: {
      state: 'PRINTING',
      temp_nozzle: 214 + Math.sin(seconds / 8) * 2,
      target_nozzle: 215,
      temp_bed: 59 + Math.sin(seconds / 11),
      target_bed: 60,
      material: ['PLA', 'PETG', 'ASA', 'TPU', 'PLA'][tool],
      filament_color: ['#fa6831', '#3bb273', '#4b8cff', '#f6c945', '#ffffff'][tool],
      filament_changes: Math.floor(progress / 4),
      filament_changes_total: 124,
      tool: tool + 1,
      tools_total: 5,
      layer: Math.floor(progress * 3),
      layer_total: 300,
      waste_g: Math.round(progress * 0.31 * 10) / 10,
      waste_total_g: 31,
      speed: 100,
      flow: 95,
      axis_z: progress * 1.8,
      fan_hotend: 8200,
      fan_print: 55,
    },
    job: {
      file: { display_name: 'demo-indx-toolchange.bgcode' },
      progress,
      time_printing: seconds % 600,
      time_remaining: 600 - (seconds % 600),
    },
  });
}

async function pollPrinter(printer) {
  if (printer.type === 'demo') return pollDemo(printer);
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
    const buf = await downloadFile(printer.host, (url, options) => fetchWithPrinterAuth(printer, url, options), download);
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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.UPLOAD_LIMIT_BYTES || 250 * 1024 * 1024) },
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function summarizeMeta(meta, fileName = 'upload') {
  const tools = new Map();
  for (const event of meta.toolEvents || []) {
    tools.set(event.tool, (tools.get(event.tool) || 0) + 1);
  }
  const firstEvents = (meta.toolEvents || []).slice(0, 20).map((e) => ({
    tool: e.tool + 1,
    progress: Math.round((e.pe ?? e.p ?? 0) * 100) / 100,
  }));
  const grams = (value) => {
    if (value == null) return null;
    const factor = Math.abs(value) < 1 ? 100 : 10;
    return Math.round(value * factor) / factor;
  };
  return {
    fileName,
    toolsTotal: meta.toolsTotal || tools.size || null,
    changesTotal: meta.changesTotal || 0,
    layerTotal: meta.layerTotal || 0,
    wasteTotalG: grams(meta.wasteTotalG),
    totalUsedG: grams(meta.totalUsedG),
    materials: meta.materials || [],
    colors: meta.colors || [],
    toolUseCounts: [...tools.entries()].map(([tool0, count]) => ({ tool: tool0 + 1, count })),
    firstEvents,
    detectedIndx: (meta.toolEvents || []).length > 0 && /M8600|filament_multitool/i.test(JSON.stringify(meta.config || {})),
  };
}

async function testPrinter(printer) {
  if (printer.type === 'demo') {
    await pollDemo(printer);
  } else if (printer.type === 'octoprint') {
    await pollOctoPrint(printer);
  } else if (printer.type === 'moonraker') {
    await pollMoonraker(printer);
  } else {
    await pollPrusaLink(printer);
  }
  return states.get(printer.id);
}

app.get('/api/health', (req, res) => {
  const printers = config.printers.map((p) => {
    const state = enrichState(p.id, states.get(p.id));
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      model: p.model || 'custom',
      capabilities: modelCapabilities(p.model),
      host: p.host,
      cameraUrl: p.cameraUrl || '',
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
    version: PACKAGE_VERSION,
    pollIntervalMs: config.pollIntervalMs,
    demoMode: config.demoMode,
    printers,
  });
});

function subnetFromRequest(req) {
  const remote = req.socket?.remoteAddress || '';
  const match = remote.match(/(\d+\.\d+\.\d+)\.\d+$/);
  return match ? `${match[1]}.0/24` : '192.168.1.0/24';
}

function hostsFromCidr(cidr) {
  const match = String(cidr || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.0\/24$/);
  if (!match) return [];
  const prefix = `${match[1]}.${match[2]}.${match[3]}`;
  return Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
}

async function probeHost(host) {
  const probes = [
    { type: 'moonraker', port: 7125, path: '/server/info' },
    { type: 'prusalink', port: 80, path: '/api/v1/status' },
    { type: 'octoprint', port: 80, path: '/api/version' },
    { type: 'octoprint', port: 5000, path: '/api/version' },
  ];
  for (const probe of probes) {
    try {
      const res = await fetch(`http://${host}:${probe.port}${probe.path}`, {
        signal: AbortSignal.timeout(700),
      });
      if ([200, 401, 403].includes(res.status)) {
        return {
          host: probe.port === 80 ? host : `${host}:${probe.port}`,
          type: probe.type,
          status: res.status,
        };
      }
    } catch {
      // try next probe
    }
  }
  return null;
}

app.get('/api/discover', async (req, res) => {
  const cidr = req.query.cidr || subnetFromRequest(req);
  const hosts = hostsFromCidr(cidr);
  if (!hosts.length) {
    res.status(400).json({ ok: false, error: 'Nur /24-Netze wie 192.168.1.0/24 werden unterstützt.' });
    return;
  }
  const found = [];
  let index = 0;
  const workers = Array.from({ length: 32 }, async () => {
    while (index < hosts.length) {
      const host = hosts[index++];
      const result = await probeHost(host);
      if (result) found.push(result);
    }
  });
  await Promise.all(workers);
  res.json({ ok: true, cidr, found: found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true })) });
});

app.get('/api/config', (req, res) => {
  res.json(publicConfig());
});

app.put('/api/config', (req, res) => {
  try {
    res.json(persistConfig(req.body || {}));
    pollAll();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/printers/test', async (req, res) => {
  try {
    const body = req.body || {};
    const printer = {
      id: String(body.id || 'test'),
      name: String(body.name || body.id || 'Test'),
      type: String(body.type || 'prusalink').toLowerCase(),
      host: String(body.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
      apiKey: String(body.apiKey || ''),
      username: String(body.username || ''),
      password: String(body.password || ''),
      cameraUrl: String(body.cameraUrl || ''),
      wasteGramsPerChange: Number(body.wasteGramsPerChange || 0),
    };
    const existing = config.printers.find((p) => p.id === printer.id);
    if (printer.apiKey === '__KEEP__') {
      printer.apiKey = existing?.apiKey || '';
    }
    if (printer.password === '__KEEP__') {
      printer.password = existing?.password || '';
    }
    if (!['prusalink', 'octoprint', 'moonraker', 'demo'].includes(printer.type)) {
      throw new Error(`Unbekannter Druckertyp: ${printer.type}`);
    }
    if (printer.type !== 'demo' && !printer.host) throw new Error('Host/IP fehlt');
    if (printer.type === 'octoprint' && !printer.apiKey) throw new Error('API-Key fehlt');
    if (printer.type === 'prusalink' && !printer.apiKey && !(printer.username && printer.password)) {
      throw new Error('PrusaLink Benutzer/Passwort oder API-Key fehlt');
    }
    states.set(printer.id, initialState(printer.type));
    const state = await testPrinter(printer);
    states.delete(printer.id);
    res.json({
      ok: Boolean(state?.connected),
      connected: Boolean(state?.connected),
      state: state?.printer?.state || null,
      file: state?.job?.file?.display_name || state?.job?.file?.name || null,
      error: state?.error || null,
    });
  } catch (err) {
    res.status(400).json({ ok: false, connected: false, error: err.message });
  }
});

app.post('/api/analyze-upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file?.buffer) throw new Error('Keine Datei empfangen');
    const meta = parseFile(req.file.buffer);
    res.json({ ok: true, ...summarizeMeta(meta, req.file.originalname) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// List configured printers (id + name only, never the API key)
app.get('/api/printers', (req, res) => {
  res.json(config.printers.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    model: p.model || 'custom',
    capabilities: modelCapabilities(p.model),
    cameraUrl: p.cameraUrl || '',
  })));
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
  console.log(`Printer OBS Overlay Server laeuft auf http://localhost:${PORT}`);
  console.log(`Konfig-Oberflaeche:  http://localhost:${PORT}/`);
  console.log(`Overlay (direkt):    http://localhost:${PORT}/overlay.html`);
  if (config.printers.length) {
    console.log('Drucker:');
    for (const p of config.printers) {
      console.log(`  - ${p.id} (${p.name}) -> ${p.host}`);
    }
  }
});
