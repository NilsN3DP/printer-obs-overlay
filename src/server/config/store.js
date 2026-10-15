// Konfiguration laden, normalisieren und sicher speichern.
// Zugangsdaten (API-Key, Passwort) werden nie an das Dashboard zurueckgegeben:
// Die Oberflaeche sieht nur "apiKeySet"/"passwordSet". Leere Felder beim Speichern
// behalten den gespeicherten Wert, `null` loescht ihn.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { PRINTER_MODELS, PRINTER_TYPES, inferModel, modelById } from './models.js';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const SOCIAL_KEYS = ['youtube', 'instagram', 'tiktok', 'twitch', 'website'];
export const DEFAULT_ACCENT = '#fa6831';
const DEMO_ID = 'demo';
export const CARD_POSITIONS = ['tl', 'tr', 'bl', 'br'];

const str = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const clampNumber = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

/** Hostname/IP ohne Schema und ohne Slash am Ende ("http://1.2.3.4/" -> "1.2.3.4"). */
export function normalizeHost(value) {
  return str(value).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export function normalizeSlots(slots) {
  if (!Array.isArray(slots)) return [];
  return slots.slice(0, 8).map((slot, index) => ({
    slot: clampNumber(slot?.slot ?? index + 1, 1, 8, index + 1),
    brand: str(slot?.brand, 60),
    name: str(slot?.name, 60),
    material: str(slot?.material, 30),
    color: HEX_COLOR.test(String(slot?.color || '')) ? String(slot.color).toLowerCase() : '',
    empty: Boolean(slot?.empty),
  }));
}

export function normalizeTheme(theme = {}) {
  // Socials: neu als Liste aktiver Netzwerke, alt als Objekt {youtube: "visible"}.
  let socials;
  if (Array.isArray(theme.socials)) socials = theme.socials;
  else if (theme.socials && typeof theme.socials === 'object') {
    socials = Object.entries(theme.socials).filter(([, v]) => v).map(([k]) => k);
  } else socials = [];
  return {
    accentColor: HEX_COLOR.test(String(theme.accentColor || '')) ? String(theme.accentColor).toLowerCase() : DEFAULT_ACCENT,
    brandText: str(theme.brandText, 32),
    logoUrl: str(theme.logoUrl, 500),
    socials: socials.map(String).filter((k) => SOCIAL_KEYS.includes(k)),
  };
}

export function normalizePresets(presets) {
  if (!Array.isArray(presets)) return [];
  const seen = new Set();
  const result = [];
  for (const [i, p] of presets.entries()) {
    const id = slug(p?.id || p?.name) || `preset${i + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      name: str(p?.name || id, 60),
      layout: p?.layout === 'card' ? 'card' : 'bar',
      // Nur fuer die Karte: Groesse (0.5 - 3) und Ecke (tl, tr, bl, br).
      scale: clampNumber(p?.scale, 0.5, 3, 1),
      position: CARD_POSITIONS.includes(p?.position) ? p.position : 'tl',
      sections: Array.isArray(p?.sections) ? p.sections.map((s) => str(s, 30)).filter(Boolean) : [],
      accentColor: HEX_COLOR.test(String(p?.accentColor || '')) ? String(p.accentColor).toLowerCase() : '',
      brandText: str(p?.brandText, 32),
      socials: Array.isArray(p?.socials) ? p.socials.map(String).filter((k) => SOCIAL_KEYS.includes(k)) : null,
    });
  }
  return result;
}

/** Prueft, was einem Drucker zum Abfragen fehlt. Leere Liste = vollstaendig. */
export function printerIssues(p) {
  const issues = [];
  if (p.type === 'demo') return issues;
  if (!p.host) issues.push('Host/IP fehlt');
  if (p.type === 'prusalink' && !p.apiKey && !(p.username && p.password)) {
    issues.push('PrusaLink-Benutzer/Passwort oder API-Key fehlt');
  }
  if (p.type === 'octoprint' && !p.apiKey) issues.push('OctoPrint API-Key fehlt');
  return issues;
}

export function normalizePrinter(p, index = 0) {
  const type = PRINTER_TYPES.includes(String(p?.type || '').toLowerCase()) ? String(p.type).toLowerCase() : 'prusalink';
  const id = slug(p?.id) || `printer${index + 1}`;
  return {
    id,
    name: str(p?.name || id, 60),
    type,
    model: inferModel(p),
    host: normalizeHost(p?.host),
    apiKey: str(p?.apiKey ?? p?.api_key, 200),
    username: str(p?.username ?? p?.user, 100),
    password: String(p?.password ?? ''),
    presetId: slug(p?.presetId),
    // Gramm Abfall pro Toolwechsel – nur Fallback, wenn die Slicer-Datei nichts liefert.
    wasteGramsPerChange: clampNumber(p?.wasteGramsPerChange, 0, 100, 0),
  };
}

export function normalizeConfig(raw = {}) {
  const printers = [];
  const ids = new Set();
  for (const [i, p] of (Array.isArray(raw.printers) ? raw.printers : []).entries()) {
    if (String(p?.type || '').toLowerCase() === 'demo' || p?.id === DEMO_ID) continue;
    const printer = normalizePrinter(p, i);
    let id = printer.id;
    for (let n = 2; ids.has(id); n++) id = `${printer.id}-${n}`;
    ids.add(id);
    printers.push({ ...printer, id });
  }
  return {
    pollIntervalMs: clampNumber(raw.pollIntervalMs, 500, 60000, 2000),
    publicBaseUrl: str(raw.publicBaseUrl, 300).replace(/\/+$/, ''),
    demoMode: Boolean(raw.demoMode),
    // Ersteinrichtung erledigt? Alte Konfigurationen mit Druckern gelten als eingerichtet.
    setupDone: typeof raw.setupDone === 'boolean' ? raw.setupDone : printers.length > 0,
    wasteGramsPerChange: clampNumber(raw.wasteGramsPerChange, 0, 100, 0),
    theme: normalizeTheme(raw.theme),
    presets: normalizePresets(raw.presets),
    printers,
  };
}

function demoPrinter() {
  return {
    ...normalizePrinter({ id: DEMO_ID, name: 'Demo-Drucker', type: 'demo', model: 'coreone-indx' }),
    wasteGramsPerChange: 0.022,
    slots: normalizeSlots([
      { slot: 1, brand: 'Prusament', name: 'Galaxy Black', material: 'PLA', color: '#2b2b2b' },
      { slot: 2, brand: 'Prusament', name: 'Prusa Orange', material: 'PETG', color: '#fa6831' },
      { slot: 3, brand: 'Prusament', name: 'Pistachio', material: 'PLA', color: '#8aa05b' },
      { slot: 4, brand: 'Prusament', name: 'Azure Blue', material: 'ASA', color: '#3d7ad6' },
      { slot: 5, empty: true },
      { slot: 6, empty: true },
      { slot: 7, empty: true },
      { slot: 8, empty: true },
    ]),
  };
}

/** Einzeldrucker aus Umgebungsvariablen (Kompatibilitaet zu v1-.env). */
function configFromEnv(env) {
  if (!env.PRUSA_HOST) return null;
  return {
    pollIntervalMs: Number(env.POLL_INTERVAL_MS || 2000),
    printers: [{
      id: 'prusa',
      name: env.PRUSA_NAME || 'Prusa',
      type: 'prusalink',
      host: env.PRUSA_HOST,
      apiKey: env.PRUSA_API_KEY || '',
      username: env.PRUSA_USERNAME || '',
      password: env.PRUSA_PASSWORD || '',
    }],
  };
}

export class ConfigStore extends EventEmitter {
  /**
   * @param {{configFile: string, env?: NodeJS.ProcessEnv, logger?: Console}} options
   */
  constructor({ configFile, env = process.env, logger = console }) {
    super();
    this.configFile = configFile;
    this.env = env;
    this.logger = logger;
    this.source = null;
    this.current = normalizeConfig({});
  }

  load() {
    let raw = null;
    if (fs.existsSync(this.configFile)) {
      try {
        raw = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
        this.source = this.configFile;
      } catch (err) {
        // Kaputte Datei nicht ueberschreiben – lieber sichern und mit leerer Config starten.
        const backup = `${this.configFile}.broken-${Date.now()}`;
        fs.copyFileSync(this.configFile, backup);
        this.logger.error(`config.json ist ungueltig (${err.message}), gesichert als ${backup}`);
      }
    }
    if (!raw) {
      const fromEnv = configFromEnv(this.env);
      // Erster Start ohne Drucker: Demo-Modus an, damit man sofort etwas sieht.
      raw = fromEnv || { demoMode: true };
      this.current = normalizeConfig(raw);
      this.persist();
      this.logger.log(fromEnv
        ? `Drucker aus Umgebungsvariablen uebernommen und gespeichert: ${this.configFile}`
        : `Neue Konfiguration angelegt: ${this.configFile}`);
      return this;
    }
    this.current = normalizeConfig(raw);
    this.lastWritten = fs.readFileSync(this.configFile, 'utf8');
    return this;
  }

  /** Normalisierte Konfiguration inkl. Zugangsdaten – nur serverintern verwenden. */
  get config() {
    return this.current;
  }

  /** Alle abzufragenden Drucker inkl. virtuellem Demo-Drucker. */
  get printers() {
    return this.current.demoMode ? [...this.current.printers, demoPrinter()] : this.current.printers;
  }

  printer(id) {
    return this.printers.find((p) => p.id === id) || null;
  }

  publicPrinter(p) {
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      model: p.model,
      capabilities: modelById(p.model),
      host: p.host,
      username: p.username,
      apiKeySet: Boolean(p.apiKey),
      passwordSet: Boolean(p.password),
      presetId: p.presetId,
      wasteGramsPerChange: p.wasteGramsPerChange,
      issues: printerIssues(p),
      virtual: p.type === 'demo',
    };
  }

  /** Konfiguration fuer das Dashboard – ohne Passwoerter und Keys. */
  publicConfig() {
    const c = this.current;
    return {
      pollIntervalMs: c.pollIntervalMs,
      publicBaseUrl: c.publicBaseUrl,
      demoMode: c.demoMode,
      setupDone: c.setupDone,
      wasteGramsPerChange: c.wasteGramsPerChange,
      theme: c.theme,
      presets: c.presets,
      printerModels: PRINTER_MODELS,
      printers: this.printers.map((p) => this.publicPrinter(p)),
    };
  }

  /**
   * Uebernimmt eine Konfiguration aus dem Dashboard. Zugangsdaten:
   * leer/fehlend = behalten, `null` = loeschen, sonst neuer Wert.
   */
  update(next = {}) {
    const existing = new Map(this.current.printers.map((p) => [p.id, p]));
    const keepSecret = (incoming, previous) => {
      if (incoming === null) return '';
      if (incoming === undefined || incoming === '') return previous || '';
      return String(incoming);
    };
    const printers = (Array.isArray(next.printers) ? next.printers : this.current.printers)
      .filter((p) => p && p.type !== 'demo' && p.id !== DEMO_ID)
      .map((p) => {
        const before = existing.get(slug(p.originalId || p.id)) || existing.get(slug(p.id));
        return {
          ...p,
          apiKey: keepSecret(p.apiKey, before?.apiKey),
          password: keepSecret(p.password, before?.password),
        };
      });
    this.current = normalizeConfig({ ...this.current, ...next, printers });
    this.persist();
    this.emit('change', this.current);
    return this.publicConfig();
  }

  persist() {
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    const tmp = `${this.configFile}.tmp`;
    const text = `${JSON.stringify(this.current, null, 2)}\n`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, this.configFile);
    this.lastWritten = text;
    this.source = this.configFile;
  }

  /**
   * Aenderungen von aussen uebernehmen – z. B. wenn Windows-App und OBS-Plugin denselben
   * Datenordner nutzen oder jemand die Datei von Hand bearbeitet.
   */
  watch(intervalMs = 2000) {
    fs.watchFile(this.configFile, { interval: intervalMs }, (cur, prev) => {
      if (!cur.mtimeMs || cur.mtimeMs === prev.mtimeMs) return;
      try {
        const text = fs.readFileSync(this.configFile, 'utf8');
        if (text === this.lastWritten) return;
        this.current = normalizeConfig(JSON.parse(text));
        this.lastWritten = text;
        this.logger.log('Konfiguration wurde von aussen geaendert und neu geladen');
        this.emit('change', this.current);
      } catch {
        // halb geschriebene oder ungueltige Datei: beim naechsten Mal erneut versuchen
      }
    });
    return this;
  }

  unwatch() {
    fs.unwatchFile(this.configFile);
  }
}
