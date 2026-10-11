// Fragt alle konfigurierten Drucker zyklisch ab und meldet Aenderungen per Event.
import { EventEmitter } from 'node:events';
import { printerIssues } from '../config/store.js';
import { PrinterClient, queryPrinter } from '../printers/index.js';

/** Technische Fehler in verstaendliche Hinweise uebersetzen. */
export function friendlyError(err) {
  const code = err?.cause?.code || err?.code || '';
  if (err?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
    return 'Zeitüberschreitung – Drucker aus oder falsche IP?';
  }
  if (code === 'ECONNREFUSED') return 'Verbindung abgelehnt – läuft PrusaLink/OctoPrint/Moonraker?';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Hostname nicht gefunden';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Drucker im Netzwerk nicht erreichbar';
  return err?.message || String(err);
}

export class Poller extends EventEmitter {
  /**
   * @param {{store: import('../config/store.js').ConfigStore,
   *          metaService: import('./job-meta.js').JobMetaService,
   *          enricher: import('./enrich.js').Enricher}} deps
   */
  constructor({ store, metaService, enricher }) {
    super();
    this.setMaxListeners(200); // ein Listener je offenem Overlay (SSE)
    this.store = store;
    this.metaService = metaService;
    this.enricher = enricher;
    this.states = new Map();
    this.clients = new Map();
    this.inFlight = new Set();
    this.timer = null;
    store.on('change', () => this.reconfigure());
  }

  start() {
    this.reconfigure();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  reconfigure() {
    // Zugangsdaten koennen sich geaendert haben -> Clients neu anlegen.
    this.clients.clear();
    const ids = new Set(this.store.printers.map((p) => p.id));
    for (const id of this.states.keys()) if (!ids.has(id)) this.states.delete(id);
    this.stop();
    this.timer = setInterval(() => this.pollAll(), this.store.config.pollIntervalMs);
    this.pollAll();
  }

  client(printer) {
    let client = this.clients.get(printer.id);
    if (!client) {
      client = new PrinterClient(printer);
      this.clients.set(printer.id, client);
    }
    return client;
  }

  pollAll() {
    for (const printer of this.store.printers) this.pollOne(printer);
  }

  async pollOne(printer) {
    if (this.inFlight.has(printer.id)) return;
    const issues = printerIssues(printer);
    if (issues.length) {
      this.setState(printer, { connected: false, error: `Einrichtung unvollständig: ${issues.join(', ')}` });
      return;
    }
    this.inFlight.add(printer.id);
    try {
      const client = this.client(printer);
      const status = await queryPrinter(printer, client);
      this.setState(printer, { connected: true, error: null, ...status });
      if (printer.type === 'prusalink') this.metaService.ensure(printer, client, status.job);
    } catch (err) {
      const previous = this.states.get(printer.id) || {};
      this.setState(printer, { ...previous, connected: false, error: friendlyError(err) });
    } finally {
      this.inFlight.delete(printer.id);
    }
  }

  setState(printer, state) {
    this.states.set(printer.id, { type: printer.type, updatedAt: new Date().toISOString(), ...state });
    this.emit('update', printer.id);
  }

  /** Angereicherter Status fuer API/Overlay. */
  snapshot(printerId) {
    const printer = this.store.printer(printerId);
    if (!printer) return null;
    const state = this.states.get(printerId) || { connected: false, error: 'Noch keine Daten', type: printer.type };
    return { id: printer.id, name: printer.name, ...this.enricher.enrich(printer, state) };
  }

  /** Einmaliger Verbindungstest fuer das Dashboard (ohne zu speichern). */
  async test(printer) {
    const issues = printerIssues(printer);
    if (issues.length) return { ok: false, error: issues.join(', ') };
    try {
      const status = await queryPrinter(printer, new PrinterClient(printer));
      return {
        ok: true,
        state: status.printer?.state || null,
        file: status.job?.file?.display_name || status.job?.file?.name || null,
      };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  }
}
