// Logging auf Konsole und – fuer App und OBS-Plugin ohne sichtbares Fenster – in eine Datei.
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;

export function createLogger({ file, toFile }) {
  const write = (level, args) => {
    const line = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    const out = `${new Date().toISOString()} ${level.padEnd(5)} ${line}`;
    (level === 'ERROR' ? process.stderr : process.stdout).write(`${line}\n`);
    if (!toFile) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, `${out}\n`);
    } catch {
      // Logging darf den Server nie stoppen
    }
  };
  return {
    log: (...a) => write('INFO', a),
    info: (...a) => write('INFO', a),
    warn: (...a) => write('WARN', a),
    error: (...a) => write('ERROR', a),
  };
}
