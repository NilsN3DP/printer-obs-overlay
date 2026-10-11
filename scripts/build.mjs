// Build-Werkzeug fuer alle Auslieferungsformen.
//   node scripts/build.mjs fonts      Inter-Schrift nach src/web/fonts kopieren
//   node scripts/build.mjs exe        Windows-Einzel-Exe (Node SEA, Weboberflaeche eingebettet)
//   node scripts/build.mjs installer  Windows-Installer (Inno Setup) inkl. OBS-Plugin
//   node scripts/build.mjs all        alles nacheinander
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIcon } from './icon.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const work = path.join(dist, 'build');
const EXE_NAME = 'printer-overlay.exe';

const log = (msg) => console.log(`\x1b[36m›\x1b[0m ${msg}`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

function fonts() {
  const src = path.join(root, 'node_modules', '@fontsource-variable', 'inter', 'files');
  const out = path.join(root, 'src', 'web', 'fonts');
  fs.mkdirSync(out, { recursive: true });
  const faces = [
    ['inter-latin-wght-normal.woff2', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'],
    ['inter-latin-ext-wght-normal.woff2', 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'],
  ];
  let css = '/* Inter (SIL Open Font License 1.1) – lokal eingebunden, funktioniert auch offline. */\n';
  for (const [file, range] of faces) {
    fs.copyFileSync(path.join(src, file), path.join(out, file));
    css += `@font-face {\n  font-family: 'Inter';\n  font-style: normal;\n  font-display: swap;\n  font-weight: 100 900;\n  src: url('${file}') format('woff2');\n  unicode-range: ${range};\n}\n`;
  }
  fs.writeFileSync(path.join(out, 'inter.css'), css);
  log('Schrift nach src/web/fonts kopiert');
}

async function bundle() {
  const { build } = await import('esbuild');
  fs.mkdirSync(work, { recursive: true });
  await build({
    entryPoints: [path.join(root, 'src', 'server', 'main.js')],
    outfile: path.join(work, 'server.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    logLevel: 'warning',
    logOverride: { 'empty-import-meta': 'silent' },
  });
  log('Server gebuendelt (dist/build/server.cjs)');
}

function findSigntool() {
  const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  if (!fs.existsSync(kits)) return null;
  const versions = fs.readdirSync(kits).filter((v) => /^10\./.test(v)).sort().reverse();
  for (const v of versions) {
    const candidate = path.join(kits, v, 'x64', 'signtool.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function exe() {
  if (process.platform !== 'win32') throw new Error('Die Windows-Exe muss unter Windows gebaut werden.');
  await bundle();
  const webDir = path.join(root, 'src', 'web');
  const assets = Object.fromEntries(listFiles(webDir).map((rel) => [`web/${rel}`, path.join(webDir, rel)]));
  const blob = path.join(work, 'sea.blob');
  const seaConfig = path.join(work, 'sea-config.json');
  fs.writeFileSync(seaConfig, JSON.stringify({
    main: path.join(work, 'server.cjs'),
    output: blob,
    disableExperimentalSEAWarning: true,
    useCodeCache: true,
    assets,
  }, null, 2));
  run(process.execPath, ['--experimental-sea-config', seaConfig]);

  const target = path.join(dist, EXE_NAME);
  fs.copyFileSync(process.execPath, target);
  const signtool = findSigntool();
  if (signtool) run(signtool, ['remove', '/s', target], { stdio: 'ignore' });

  // Icon und Dateiinfos setzen, bevor der Blob injiziert wird.
  const icon = path.join(root, 'packaging', 'windows', 'app.ico');
  if (!fs.existsSync(icon)) writeIcon(icon);
  const { rcedit } = await import('rcedit');
  await rcedit(target, {
    icon,
    'file-version': pkg.version,
    'product-version': pkg.version,
    'version-string': {
      ProductName: 'Printer OBS Overlay',
      FileDescription: 'Printer OBS Overlay – Stream-Overlay fuer 3D-Drucker',
      CompanyName: 'N3DP',
      LegalCopyright: 'MIT License',
      OriginalFilename: EXE_NAME,
      InternalName: 'printer-overlay',
    },
  });

  run(process.execPath, [
    path.join(root, 'node_modules', 'postject', 'dist', 'cli.js'), target, 'NODE_SEA_BLOB', blob,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ]);
  log(`Windows-Exe erstellt: dist/${EXE_NAME} (${Math.round(fs.statSync(target).size / 1048576)} MB)`);
}

function findIscc() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles || '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

function installer() {
  const iscc = findIscc();
  if (!iscc) throw new Error('Inno Setup 6 nicht gefunden (winget install JRSoftware.InnoSetup)');
  if (!fs.existsSync(path.join(dist, EXE_NAME))) throw new Error('Zuerst die Exe bauen: npm run build:exe');
  const plugin = path.join(dist, 'obs-plugin', 'printer-overlay', 'bin', '64bit', 'printer-overlay.dll');
  if (!fs.existsSync(plugin)) throw new Error('Zuerst das OBS-Plugin bauen: npm run build:obs');
  run(iscc, [`/DAppVersion=${pkg.version}`, `/O${dist}`, path.join(root, 'packaging', 'windows', 'installer.iss')]);
  log(`Installer erstellt: dist/PrinterOBSOverlay-Setup-${pkg.version}.exe`);
}

const tasks = {
  fonts,
  exe,
  installer,
  async all() {
    fonts();
    await exe();
    run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'packaging', 'obs-plugin', 'build.ps1')]);
    installer();
  },
};

const task = tasks[process.argv[2]];
if (!task) {
  console.error(`Aufruf: node scripts/build.mjs <${Object.keys(tasks).join('|')}>`);
  process.exit(1);
}
try {
  await task();
} catch (err) {
  console.error(`\x1b[31m✗ ${err.message}\x1b[0m`);
  process.exit(1);
}
