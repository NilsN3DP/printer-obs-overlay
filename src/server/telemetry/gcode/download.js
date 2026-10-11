// Laedt die gerade gedruckte Datei vom Drucker. PrusaLink liefert waehrend eines Drucks
// teils nur ~15 KB/s – deshalb kein hartes Gesamt-Timeout, sondern ein Inaktivitaets-
// Watchdog (90 s ohne Daten) plus ein grosszuegiger Gesamtdeckel (2 h).

const INACTIVITY_MS = 90_000;
const OVERALL_MS = 2 * 60 * 60 * 1000;

/**
 * @param {import('../../printers/client.js').PrinterClient} client
 * @param {string} downloadPath  z. B. job.file.refs.download
 * @param {{onProgress?: (bytes: number, total: number|null) => void}} [opts]
 */
export async function downloadFile(client, downloadPath, { onProgress } = {}) {
  const controller = new AbortController();
  const stall = () => controller.abort(new Error('Download: 90 s keine Daten'));
  let watchdog = setTimeout(stall, INACTIVITY_MS);
  const overall = setTimeout(() => controller.abort(new Error('Download: 2 h Gesamtlimit')), OVERALL_MS);

  try {
    const res = await client.request(downloadPath, { signal: controller.signal });
    if (!res.ok) throw new Error(`Download ${downloadPath} -> HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || null;
    const chunks = [];
    let bytes = 0;
    for await (const chunk of res.body) {
      clearTimeout(watchdog);
      watchdog = setTimeout(stall, INACTIVITY_MS);
      chunks.push(Buffer.from(chunk));
      bytes += chunk.length;
      onProgress?.(bytes, total);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    // AbortError traegt die eigentliche Ursache im signal.reason
    if (err?.name === 'AbortError' && controller.signal.reason instanceof Error) throw controller.signal.reason;
    throw err;
  } finally {
    clearTimeout(watchdog);
    clearTimeout(overall);
  }
}
