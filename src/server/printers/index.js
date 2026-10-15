// Adapter-Registry: Druckertyp -> Abfragefunktion.
import { PrinterClient } from './client.js';
import { demoStatus } from './demo.js';
import { pollMoonraker } from './moonraker.js';
import { pollOctoPrint } from './octoprint.js';
import { pollPrusaLink } from './prusalink.js';

const ADAPTERS = {
  prusalink: pollPrusaLink,
  octoprint: pollOctoPrint,
  moonraker: pollMoonraker,
  demo: async () => demoStatus(),
};

/** Fragt einen Drucker einmal ab. Wirft bei Verbindungs-/Auth-Fehlern. */
export async function queryPrinter(printer, client = new PrinterClient(printer)) {
  const adapter = ADAPTERS[printer.type];
  if (!adapter) throw new Error(`Unbekannter Druckertyp: ${printer.type}`);
  return adapter(client, printer);
}

export { PrinterClient };
