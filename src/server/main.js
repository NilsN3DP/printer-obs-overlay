// Einstiegspunkt des Overlay-Servers (vom OBS-Plugin gestartet oder per npm run dev).
import path from 'node:path';
import { createApp } from './app.js';
import { ConfigStore } from './config/store.js';
import { createLogger } from './logger.js';
import { openBrowser } from './platform/system.js';
import { runtime } from './runtime.js';
import { Enricher } from './telemetry/enrich.js';
import { JobMetaService } from './telemetry/job-meta.js';
import { Poller } from './telemetry/poller.js';

const logger = createLogger({ file: runtime.logFile, toFile: runtime.mode === 'obs' });
const localUrl = `http://${runtime.host === '0.0.0.0' || runtime.host === '127.0.0.1' ? 'localhost' : runtime.host}:${runtime.port}`;

async function main() {
  const store = new ConfigStore({ configFile: runtime.configFile, logger }).load().watch();
  const metaService = new JobMetaService({
    cacheDir: path.join(runtime.cacheDir, 'gcode'),
    legacyCacheDirs: [path.join(runtime.dataDir, 'meta-cache')], // Cache aus Version 1
    logger,
  });
  const enricher = new Enricher({
    metaService,
    globalWaste: () => store.config.wasteGramsPerChange,
    toolchangerEnabled: () => store.config.toolchangerEnabled,
  });
  const poller = new Poller({ store, metaService, enricher });
  const server = createApp({ runtime, store, poller, logger });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${runtime.port} ist belegt. Anderen Port waehlen: --port <nummer> bzw. PORT=<nummer>`);
    } else {
      logger.error(err);
    }
    process.exit(1);
  });

  server.listen(runtime.port, runtime.host, () => {
    poller.start();
    logger.log(`Printer OBS Overlay ${runtime.version} (${runtime.mode}) laeuft`);
    logger.log(`  Dashboard: ${localUrl}/`);
    logger.log(`  Overlay:   ${localUrl}/overlay.html`);
    logger.log(`  Daten:     ${runtime.dataDir}`);
    const real = store.config.printers;
    logger.log(real.length
      ? `  Drucker:   ${real.map((p) => `${p.name} (${p.type} ${p.host})`).join(', ')}`
      : '  Drucker:   noch keine – im Dashboard hinzufuegen');
    if (runtime.openBrowser) openBrowser(`${localUrl}/`);
  });

  const shutdown = () => {
    poller.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
