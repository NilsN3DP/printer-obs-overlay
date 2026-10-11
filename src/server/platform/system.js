// Betriebssystem-Funktionen fuer die Windows-App: Browser oeffnen und Autostart.
import { execFile, spawn } from 'node:child_process';
import { runtime } from '../runtime.js';

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'PrinterOBSOverlay';

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
});

export function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // ohne Browser geht es auch – die URL steht im Log
  }
}

export const autostart = {
  /** Nur die installierte Windows-App kann sich selbst in den Autostart eintragen. */
  supported: () => runtime.platform === 'win32' && runtime.mode === 'app' && runtime.isSea,

  async enabled() {
    if (!this.supported()) return false;
    const { ok, stdout } = await run('reg', ['query', RUN_KEY, '/v', RUN_VALUE]);
    return ok && stdout.includes(RUN_VALUE);
  },

  async set(enabled) {
    if (!this.supported()) throw new Error('Autostart wird nur von der Windows-App unterstützt');
    if (!enabled) {
      await run('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f']);
      return false;
    }
    // conhost --headless startet die App ohne sichtbares Konsolenfenster.
    const command = `conhost.exe --headless "${process.execPath}" --background`;
    const { ok } = await run('reg', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', command, '/f']);
    if (!ok) throw new Error('Autostart konnte nicht gesetzt werden');
    return true;
  },
};
