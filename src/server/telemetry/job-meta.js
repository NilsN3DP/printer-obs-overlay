// Haelt pro Drucker die G-Code-Metadaten des laufenden Drucks bereit.
// Jede Datei wird genau einmal geladen und geparst; das Ergebnis landet im Disk-Cache
// (ueberlebt Neustarts). Fehlversuche werden nach 5 Minuten wiederholt.
import fs from 'node:fs';
import path from 'node:path';
import { downloadFile } from './gcode/download.js';
import { parseFile } from './gcode/parse.js';

const RETRY_AFTER_MS = 5 * 60 * 1000;
const MAX_CACHE_FILES = 60;

export class JobMetaService {
  /** @param {{cacheDir: string, legacyCacheDirs?: string[], logger?: Console}} options */
  constructor({ cacheDir, legacyCacheDirs = [], logger = console }) {
    this.cacheDir = cacheDir;
    this.legacyCacheDirs = legacyCacheDirs;
    this.logger = logger;
    this.entries = new Map(); // printerId -> { key, meta, fetching, failedAt, error, bytes, total, file }
  }

  static keyFor(file) {
    return `${file.name}:${file.size ?? ''}`;
  }

  cachePath(dir, key) {
    return path.join(dir, `${key.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
  }

  readCache(key) {
    for (const dir of [this.cacheDir, ...this.legacyCacheDirs]) {
      try {
        return JSON.parse(fs.readFileSync(this.cachePath(dir, key), 'utf8'));
      } catch {
        // naechstes Verzeichnis probieren
      }
    }
    return null;
  }

  writeCache(key, meta) {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(this.cachePath(this.cacheDir, key), JSON.stringify(meta));
      this.prune();
    } catch (err) {
      this.logger.warn(`Meta-Cache konnte nicht geschrieben werden: ${err.message}`);
    }
  }

  /** Haelt den Cache klein: nur die juengsten Dateien bleiben. */
  prune() {
    const files = fs.readdirSync(this.cacheDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, t: fs.statSync(path.join(this.cacheDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(MAX_CACHE_FILES)) fs.rmSync(path.join(this.cacheDir, f), { force: true });
  }

  get(printerId) {
    return this.entries.get(printerId)?.meta ?? null;
  }

  /** Zustand fuer das Dashboard (Download-Fortschritt, Fehler). */
  status(printerId) {
    const e = this.entries.get(printerId);
    if (!e) return { state: 'idle' };
    if (e.meta) return { state: 'ready', file: e.file };
    if (e.fetching) return { state: 'downloading', file: e.file, bytes: e.bytes || 0, total: e.total || null };
    return { state: 'failed', file: e.file, error: e.error };
  }

  /**
   * Stoesst bei Bedarf den Download der Druckdatei an (nicht blockierend).
   * @param {{id: string}} printer
   * @param {import('../printers/client.js').PrinterClient} client
   * @param {object|null} job  PrusaLink-Job mit file.refs.download
   */
  ensure(printer, client, job) {
    const file = job?.file;
    const download = file?.refs?.download;
    if (!file || !download) {
      // Kein Job mehr: alten Eintrag vergessen, damit der naechste Druck frisch startet.
      if (!job) this.entries.delete(printer.id);
      return;
    }
    const key = JobMetaService.keyFor(file);
    const label = file.display_name || file.name;
    const entry = this.entries.get(printer.id);
    if (entry?.key === key && (entry.meta || entry.fetching)) return;
    if (entry?.key === key && entry.failedAt && Date.now() - entry.failedAt < RETRY_AFTER_MS) return;

    const cached = this.readCache(key);
    if (cached) {
      this.entries.set(printer.id, { key, meta: cached, file: label });
      this.logger.log(`[${printer.id}] G-Code-Daten aus Cache: ${label}`);
      return;
    }

    const state = { key, fetching: true, file: label, bytes: 0, total: null };
    this.entries.set(printer.id, state);
    this.logger.log(`[${printer.id}] Lade Druckdatei fuer Toolwechsel/Layer: ${label}`);
    downloadFile(client, download, {
      onProgress: (bytes, total) => {
        state.bytes = bytes;
        state.total = total;
      },
    })
      .then((buf) => {
        const meta = parseFile(buf);
        this.entries.set(printer.id, { key, meta, file: label });
        this.writeCache(key, meta);
        this.logger.log(`[${printer.id}] G-Code ok: ${meta.changesTotal} Wechsel, ${meta.layerTotal} Layer, `
          + `${meta.toolsTotal ?? '?'} Tools (${Math.round(buf.length / 1024)} KiB)`);
      })
      .catch((err) => {
        this.logger.error(`[${printer.id}] G-Code-Analyse fehlgeschlagen: ${err.message}`);
        this.entries.set(printer.id, { key, meta: null, failedAt: Date.now(), error: err.message, file: label });
      });
  }
}
