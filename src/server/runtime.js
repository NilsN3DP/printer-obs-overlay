// Laufzeit-Umgebung: Version, Betriebsart, Datenverzeichnis und Startparameter.
// Gilt fuer alle drei Varianten (Docker, Windows-App, OBS-Plugin) gleichermassen.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sea from 'node:sea';
import { fileURLToPath } from 'node:url';

const isSea = (() => {
  try {
    return sea.isSea();
  } catch {
    return false;
  }
})();

const repoRoot = isSea ? path.dirname(process.execPath) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readVersion() {
  // Im Einzel-Exe-Build wird die Version per esbuild-define eingesetzt.
  // eslint-disable-next-line no-undef
  if (typeof __APP_VERSION__ !== 'undefined') return __APP_VERSION__;
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

function parseArgs(argv) {
  const args = { open: false, background: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--port') args.port = Number(next());
    else if (arg === '--host') args.host = next();
    else if (arg === '--data-dir') args.dataDir = next();
    else if (arg === '--open') args.open = true;
    else if (arg === '--background') args.background = true;
    else if (arg.startsWith('--port=')) args.port = Number(arg.slice(7));
    else if (arg.startsWith('--host=')) args.host = arg.slice(7);
    else if (arg.startsWith('--data-dir=')) args.dataDir = arg.slice(11);
  }
  return args;
}

function detectMode() {
  const fromEnv = String(process.env.PO_MODE || '').toLowerCase();
  if (['docker', 'obs', 'app', 'dev'].includes(fromEnv)) return fromEnv;
  return isSea ? 'app' : 'dev';
}

function defaultDataDir(mode) {
  if (mode === 'docker') return '/config';
  if (mode === 'app' || mode === 'obs') {
    const base = process.env.APPDATA
      || (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : path.join(os.homedir(), '.config'));
    return path.join(base, 'PrinterOverlay');
  }
  return path.join(repoRoot, 'data');
}

function resolveRuntime() {
  // Lokale .env (falls vorhanden) wie bisher unterstuetzen – ohne dotenv-Abhaengigkeit.
  try {
    if (!isSea && fs.existsSync(path.join(repoRoot, '.env'))) process.loadEnvFile(path.join(repoRoot, '.env'));
  } catch {
    // .env ist optional
  }

  const args = parseArgs(process.argv.slice(2));
  const mode = detectMode();
  // Alte v1-Variable CONFIG_PATH gilt nur, solange kein Datenordner explizit gesetzt ist.
  const legacyConfigPath = args.dataDir || process.env.DATA_DIR ? '' : process.env.CONFIG_PATH || '';
  const dataDir = path.resolve(args.dataDir
    || process.env.DATA_DIR
    || (legacyConfigPath ? path.dirname(legacyConfigPath) : defaultDataDir(mode)));
  const configFile = legacyConfigPath ? path.resolve(legacyConfigPath) : path.join(dataDir, 'config.json');

  // Docker muss im LAN erreichbar sein; App und OBS-Plugin standardmaessig nur lokal.
  const defaultHost = mode === 'docker' || mode === 'dev' ? '0.0.0.0' : '127.0.0.1';
  const defaultPort = mode === 'obs' ? 4217 : 4200;

  return {
    version: readVersion(),
    mode,
    isSea,
    platform: process.platform,
    repoRoot,
    dataDir,
    configFile,
    cacheDir: process.env.META_CACHE_DIR ? path.resolve(process.env.META_CACHE_DIR) : path.join(dataDir, 'cache'),
    logFile: path.join(dataDir, 'server.log'),
    host: args.host || process.env.HOST || defaultHost,
    port: Number(args.port || process.env.PORT || defaultPort),
    publicBaseUrl: String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    openBrowser: args.open && !args.background,
    background: args.background,
  };
}

export const runtime = resolveRuntime();
